import { EventConsumerUtil } from './event-consumer.util';

describe('EventConsumerUtil', () => {
  describe('retryDelay', () => {
    it('doubles from one second up to thirty', () => {
      expect([1, 2, 3, 4, 5, 6, 7].map((attempt) => EventConsumerUtil.retryDelay(attempt))).toEqual([
        1000, 2000, 4000, 8000, 16_000, 30_000, 30_000,
      ]);
    });
  });
});
