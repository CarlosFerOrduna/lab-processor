import { BeforeApplicationShutdown, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, MessagesStream, stringDeserializers } from '@platformatic/kafka';
import { readFileSync } from 'node:fs';
import { EVENT_CONSUMER } from './constants/event-consumer.constant';
import { EventMessageProcessor } from './event-message.processor';

/**
 * Consumes the producers' topics as the configured consumer group, one message at a time, and
 * hands each message to EventMessageProcessor, which commits it.
 */
@Injectable()
export class EventConsumerService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private readonly logger = new Logger(EventConsumerService.name);
  private readonly shutdown = new AbortController();
  private consumer?: Consumer<string, string, string, string>;
  private stream?: MessagesStream<string, string, string, string>;
  private loop?: Promise<void>;

  constructor(
    private readonly config: ConfigService,
    private readonly eventMessageProcessor: EventMessageProcessor,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const topics = this.config.getOrThrow<string>('KAFKA_TOPICS').split(',');
    this.consumer = new Consumer({
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
    this.stream = await this.consumer.consume({
      topics,
      autocommit: false,
      // Un group sin offsets confirmados empieza desde el principio de cada partición, sin saltear nada.
      mode: 'committed',
      fallbackMode: 'earliest',
    });
    this.logger.log(`Consuming ${topics.join(', ')}`);
    this.loop = this.consumeAll(this.stream);
  }

  async beforeApplicationShutdown(): Promise<void> {
    // Corta antes de que se cierre la conexión a la base: el mensaje en curso termina (guardado y
    // confirmado) o se abandona sin confirmar, y se vuelve a leer después.
    this.shutdown.abort();
    await this.stream?.close();
    await this.loop;
    await this.consumer?.close();
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
      this.logger.error(`Consuming stopped: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  }
}
