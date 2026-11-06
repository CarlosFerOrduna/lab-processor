import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EVENT_CONSUMER } from './constants/event-consumer.constant';
import { EventConsumerService } from './event-consumer.service';
import { EventMessageProcessor } from './event-message.processor';
import { KafkaConsumer } from './types/kafka-consumer.type';

function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const altnameError = codedError('ERR_TLS_CERT_ALTNAME_INVALID', "Hostname/IP does not match certificate's altnames");
const refusedError = codedError('ECONNREFUSED', 'connect ECONNREFUSED 10.43.0.10:9093');

describe('EventConsumerService', () => {
  let metadata: jest.Mock;
  let consume: jest.Mock;
  let close: jest.Mock;
  let service: EventConsumerService;
  let wait: jest.SpyInstance;
  let error: jest.SpyInstance;
  let log: jest.SpyInstance;
  let exit: jest.SpyInstance;
  let now: number;

  function starting(): Promise<void> {
    return (service as unknown as { starting: Promise<void> }).starting;
  }

  beforeEach(() => {
    now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    metadata = jest.fn().mockResolvedValue({});
    consume = jest.fn();
    close = jest.fn().mockResolvedValue(undefined);
    const config = { getOrThrow: jest.fn().mockReturnValue('producer-a.messages,producer-b.items') };
    service = new EventConsumerService(config as unknown as ConfigService, {} as EventMessageProcessor);
    jest
      .spyOn(service as unknown as { createConsumer: () => KafkaConsumer }, 'createConsumer')
      .mockReturnValue({ metadata, consume, close } as unknown as KafkaConsumer);
    wait = jest
      .spyOn(service as unknown as { wait: (ms: number) => Promise<void> }, 'wait')
      .mockImplementation((ms) => {
        now += ms;
        return Promise.resolve();
      });
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    exit = jest.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('returns from bootstrap while Kafka is still connecting, so /health can start listening', () => {
    metadata.mockReturnValue(new Promise(() => undefined));

    const result = service.onApplicationBootstrap();

    expect(result).toBeUndefined();
    expect(metadata).toHaveBeenCalledWith({ topics: ['producer-a.messages', 'producer-b.items'], retries: 0 });
  });

  it('fails at once on a certificate error, without retrying, and exits with 1', async () => {
    metadata.mockRejectedValue(new AggregateError([altnameError], 'Cannot connect to any broker.'));

    service.onApplicationBootstrap();
    await starting();

    expect(metadata).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(consume).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('<- Error[ERR_TLS_CERT_ALTNAME_INVALID]'));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('retries an unreachable Kafka until the startup deadline, then exits with 1', async () => {
    metadata.mockRejectedValue(new AggregateError([refusedError], 'Cannot connect to any broker.'));

    service.onApplicationBootstrap();
    await starting();

    const attempts = metadata.mock.calls.length;
    expect(attempts).toBe(EVENT_CONSUMER.startupTimeoutMs / EVENT_CONSUMER.startupRetryDelayMs);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Kafka was not reachable within 120 s <- Error[ECONNREFUSED]'),
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('starts consuming once a broker answers', async () => {
    metadata.mockRejectedValueOnce(refusedError).mockResolvedValue({});
    consume.mockResolvedValue((async function* () {})());
    jest.spyOn(service as unknown as { consumeAll: () => Promise<void> }, 'consumeAll').mockResolvedValue();

    service.onApplicationBootstrap();
    await starting();

    expect(metadata).toHaveBeenCalledTimes(2);
    expect(consume).toHaveBeenCalledWith(expect.objectContaining({ autocommit: false, mode: 'committed' }));
    expect(log).toHaveBeenCalledWith('Consuming producer-a.messages, producer-b.items');
    expect(exit).not.toHaveBeenCalled();
  });

  it('closes the client when consume() outlasts the deadline, and exits with 1', async () => {
    jest.useFakeTimers();
    let rejectConsume: (reason: Error) => void = () => undefined;
    consume.mockReturnValue(new Promise((_, reject) => (rejectConsume = reject)));
    close.mockImplementation(() => {
      rejectConsume(new Error('Client is closed.'));
      return Promise.resolve();
    });

    service.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(EVENT_CONSUMER.startupTimeoutMs);
    await starting();

    expect(close).toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Kafka was not reachable within 120 s'));
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('never leaves the start rejected, even if logging the failure throws', async () => {
    metadata.mockRejectedValue(altnameError);
    error.mockImplementation(() => {
      throw new Error('stdout closed');
    });

    service.onApplicationBootstrap();

    await expect(starting()).resolves.toBeUndefined();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('does not treat a shutdown during startup as a failure', async () => {
    let rejectMetadata: (reason: Error) => void = () => undefined;
    metadata.mockReturnValue(new Promise((_, reject) => (rejectMetadata = reject)));
    close.mockImplementation(() => {
      rejectMetadata(new Error('Client is closed.'));
      return Promise.resolve();
    });
    wait.mockRejectedValue(new Error('The operation was aborted'));

    service.onApplicationBootstrap();
    await service.beforeApplicationShutdown();

    expect(log).toHaveBeenCalledWith('Stopped before consuming started');
    expect(error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
