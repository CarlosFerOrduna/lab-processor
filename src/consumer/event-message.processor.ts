import { Injectable, Logger } from '@nestjs/common';
import { setTimeout as sleep } from 'node:timers/promises';
import { DatabaseErrorUtil } from '../database/database-error.util';
import { CreateEventDto, createEventSchema } from '../events/dto/create-event.dto';
import { EventsRepository } from '../events/events.repository';
import { EventConsumerUtil } from './event-consumer.util';
import { ConsumedMessage } from './types/consumed-message.type';
import { MessageOutcome } from './types/message-outcome.type';

/**
 * Stores one event from Kafka and commits its offset only after it is stored (at-least-once:
 * storing is idempotent by the event's id). Only a message at fault is skipped: one that is not a
 * valid event, or that the database rejects for its data (SQLSTATE classes 22 and 23). It is
 * logged, without its value, and committed, so it does not block its partition. Any other error is
 * retried on the same message, without committing, until it succeeds or the consumer shuts down: a
 * database outage, a missing table or a bug never lose messages.
 */
@Injectable()
export class EventMessageProcessor {
  private readonly logger = new Logger(EventMessageProcessor.name);

  constructor(private readonly eventsRepository: EventsRepository) {}

  async process(message: ConsumedMessage, signal: AbortSignal): Promise<MessageOutcome> {
    const event = this.parse(message);
    if (typeof event === 'string') {
      return this.skip(message, event);
    }

    for (let attempt = 1; ; attempt++) {
      if (signal.aborted) {
        return 'aborted';
      }
      try {
        await this.eventsRepository.saveIfNew(event);
        await message.commit();
        return 'stored';
      } catch (error) {
        const kind = DatabaseErrorUtil.classify(error);
        const sqlState = DatabaseErrorUtil.sqlStateOf(error);
        if (kind === 'duplicate') {
          await message.commit();
          return 'stored';
        }
        if (kind === 'poison') {
          // Sin el mensaje de PostgreSQL: puede repetir el dato rechazado ("invalid input syntax for type uuid: ...").
          return this.skip(message, 'the database rejected its data', sqlState);
        }
        const delay = EventConsumerUtil.retryDelay(attempt);
        this.logger.warn(
          `Could not store ${describe(message)} (attempt ${attempt}, SQLSTATE ${sqlState ?? 'none'}): ${messageOf(error)}. Retrying in ${delay} ms`,
        );
        const isStillRunning = await this.wait(delay, signal);
        if (!isStillRunning) {
          return 'aborted';
        }
      }
    }
  }

  /** Waits before the next attempt; false if the consumer shut down meanwhile. */
  protected async wait(delayMs: number, signal: AbortSignal): Promise<boolean> {
    try {
      await sleep(delayMs, undefined, { signal });
      return true;
    } catch {
      return false;
    }
  }

  /** The validated event, or why the message can never be one. */
  private parse(message: ConsumedMessage): CreateEventDto | string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(message.value ?? '');
    } catch {
      return 'value is not JSON';
    }
    const result = createEventSchema.validate(parsed, { abortEarly: false, stripUnknown: true });
    if (result.error) {
      return `value is not a valid event: ${result.error.details.map((detail) => detail.message).join('; ')}`;
    }
    return result.value;
  }

  private async skip(message: ConsumedMessage, reason: string, sqlState?: string): Promise<MessageOutcome> {
    const valueBytes = Buffer.byteLength(message.value ?? '');
    this.logger.warn(
      `Skipping ${describe(message)}: ${reason} (SQLSTATE ${sqlState ?? 'none'}, value length ${valueBytes} bytes)`,
    );
    await message.commit();
    return 'skipped';
  }
}

function describe(message: ConsumedMessage): string {
  return `${message.topic}/${message.partition}@${message.offset} (key ${JSON.stringify(message.key ?? null)})`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
