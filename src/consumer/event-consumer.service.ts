import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, MessagesStream, stringDeserializers } from '@platformatic/kafka';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { ErrorCausesUtil } from '../common/utils/error-causes.util';
import { EVENT_CONSUMER } from './constants/event-consumer.constant';
import { EventConsumerUtil } from './event-consumer.util';
import { EventMessageProcessor } from './event-message.processor';
import { KafkaConsumer } from './types/kafka-consumer.type';

/**
 * Consumes the producers' topics as the configured consumer group, one message at a time, and
 * hands each message to EventMessageProcessor, which commits it.
 */
@Injectable()
export class EventConsumerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(EventConsumerService.name);
  private readonly shutdown = new AbortController();
  private consumer?: KafkaConsumer;
  private stream?: MessagesStream<string, string, string, string>;
  private loop?: Promise<void>;
  private starting?: Promise<void>;

  constructor(
    private readonly config: ConfigService,
    private readonly eventMessageProcessor: EventMessageProcessor,
  ) {}

  onApplicationBootstrap(): void {
    // No se espera: Nest no abre el puerto de /health hasta que terminan estos hooks, y conectarse a
    // Kafka puede llevar minutos de reintentos. Esperando, la liveness mataría el pod antes de que se
    // vea por qué no conecta.
    this.starting = this.startConsuming().catch((error: unknown) => this.onStartFailed(error));
  }

  private async startConsuming(): Promise<void> {
    const topics = this.config.getOrThrow<string>('KAFKA_TOPICS').split(',');
    const deadline = Date.now() + EVENT_CONSUMER.startupTimeoutMs;
    const consumer = this.createConsumer();
    this.consumer = consumer;
    await this.waitForBrokers(consumer, topics, deadline);

    // consume() reintenta por su cuenta (y anidado): cerrar el cliente al vencer el plazo es lo que lo acota.
    let hasTimedOut = false;
    const timer = setTimeout(
      () => {
        hasTimedOut = true;
        consumer.close().catch(() => undefined);
      },
      Math.max(deadline - Date.now(), 0),
    );
    try {
      this.stream = await consumer.consume({
        topics,
        autocommit: false,
        // Un group sin offsets confirmados empieza desde el principio de cada partición, sin saltear nada.
        mode: 'committed',
        fallbackMode: 'earliest',
      });
    } catch (error) {
      throw hasTimedOut ? this.startupTimeoutError(error) : error;
    } finally {
      clearTimeout(timer);
    }
    this.logger.log(`Consuming ${topics.join(', ')}`);
    this.loop = this.consumeAll(this.stream);
  }

  /**
   * Waits until a broker answers with the topics' metadata. A certificate error fails at once;
   * anything else is retried until the deadline.
   */
  private async waitForBrokers(consumer: KafkaConsumer, topics: string[], deadline: number): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await consumer.metadata({ topics, retries: 0 });
        return;
      } catch (error) {
        if (EventConsumerUtil.isCertificateError(error)) {
          throw error;
        }
        const delay = EVENT_CONSUMER.startupRetryDelayMs;
        if (Date.now() + delay >= deadline) {
          throw this.startupTimeoutError(error);
        }
        this.logger.warn(`Kafka is not reachable yet (attempt ${attempt}): ${ErrorCausesUtil.describe(error)}`);
        await this.wait(delay);
      }
    }
  }

  private startupTimeoutError(cause: unknown): Error {
    const seconds = EVENT_CONSUMER.startupTimeoutMs / 1000;
    return new Error(`Kafka was not reachable within ${seconds} s`, { cause });
  }

  /** Waits before the next attempt; rejects if the consumer shuts down meanwhile. */
  protected async wait(delayMs: number): Promise<void> {
    await sleep(delayMs, undefined, { signal: this.shutdown.signal });
  }

  async beforeApplicationShutdown(): Promise<void> {
    // Corta antes de que se cierre la conexión a la base: el mensaje en curso termina (guardado y
    // confirmado) o se abandona sin confirmar, y se vuelve a leer después.
    this.shutdown.abort();
    await this.stream?.close();
    await this.loop;
    await this.consumer?.close();
    await this.starting;
  }

  /** Ends every failed start: logs why and exits. Never throws, so the start never rejects unhandled. */
  private onStartFailed(error: unknown): void {
    try {
      if (this.shutdown.signal.aborted) {
        this.logger.log('Stopped before consuming started');
        return;
      }
      this.logger.error(`Could not start consuming: ${ErrorCausesUtil.describe(error)}`);
    } catch {
      // Si hasta el log falla, igual hay que salir: un consumidor sin arrancar no puede quedar vivo.
    }
    if (!this.shutdown.signal.aborted) {
      process.exit(1);
    }
  }

  /** The Kafka client, with mTLS from the mounted certificate files. */
  protected createConsumer(): KafkaConsumer {
    return new Consumer({
      clientId: this.config.getOrThrow<string>('KAFKA_CLIENT_ID'),
      groupId: this.config.getOrThrow<string>('KAFKA_GROUP_ID'),
      bootstrapBrokers: this.config.getOrThrow<string>('KAFKA_BOOTSTRAP_BROKERS').split(','),
      // Solo ca, cert y key: Node verifica la cadena y el hostname del broker por defecto, y no hay que tocarlo.
      tls: {
        ca: readFileSync(this.config.getOrThrow<string>('KAFKA_CA_FILE')),
        cert: readFileSync(this.config.getOrThrow<string>('KAFKA_CERT_FILE')),
        key: readFileSync(this.config.getOrThrow<string>('KAFKA_KEY_FILE')),
      },
      deserializers: stringDeserializers,
      retries: EVENT_CONSUMER.clientRetries,
      retryDelay: EVENT_CONSUMER.clientRetryDelayMs,
    });
  }

  private async consumeAll(stream: MessagesStream<string, string, string, string>): Promise<void> {
    try {
      for await (const message of stream) {
        const outcome = await this.eventMessageProcessor.process(message, this.shutdown.signal);
        if (outcome === 'aborted') {
          break;
        }
      }
    } catch (error) {
      if (this.shutdown.signal.aborted) {
        return;
      }
      // El cliente se rindió (Kafka inalcanzable, un commit fallido...): salir y que Kubernetes reinicie
      // el pod no pierde nada, porque el mensaje sin confirmar se vuelve a leer.
      this.logger.error(`Consuming stopped: ${ErrorCausesUtil.describe(error)}`);
      process.exit(1);
    }
  }
}
