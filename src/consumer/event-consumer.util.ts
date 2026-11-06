import { ErrorCausesUtil } from '../common/utils/error-causes.util';
import { EVENT_CONSUMER } from './constants/event-consumer.constant';

/** Helpers for the Kafka consumer. */
export class EventConsumerUtil {
  /** Delay before the next attempt at storing the same message: doubles from 1 s and never exceeds 30 s. */
  static retryDelay(attempt: number): number {
    const exponentialDelay = EVENT_CONSUMER.retryBaseDelayMs * 2 ** Math.max(attempt - 1, 0);
    return Math.min(exponentialDelay, EVENT_CONSUMER.retryMaxDelayMs);
  }

  /** Whether a Kafka connection failed on a certificate (anywhere in the chain): retrying cannot fix it. */
  static isCertificateError(error: unknown): boolean {
    return ErrorCausesUtil.some(error, (candidate) => {
      const { code } = (candidate ?? {}) as { code?: unknown };
      return typeof code === 'string' && EVENT_CONSUMER.certificateErrorCodes.some((pattern) => pattern.test(code));
    });
  }
}
