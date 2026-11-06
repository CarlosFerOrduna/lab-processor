import { EVENT_CONSUMER } from './constants/event-consumer.constant';

/** Helpers for the Kafka consumer. */
export class EventConsumerUtil {
  /** Delay before the next attempt at storing the same message: doubles from 1 s and never exceeds 30 s. */
  static retryDelay(attempt: number): number {
    const exponentialDelay = EVENT_CONSUMER.retryBaseDelayMs * 2 ** Math.max(attempt - 1, 0);
    return Math.min(exponentialDelay, EVENT_CONSUMER.retryMaxDelayMs);
  }
}
