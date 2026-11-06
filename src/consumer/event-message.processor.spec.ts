import { Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { EventsRepository } from '../events/events.repository';
import { EventMessageProcessor, retryDelayMs } from './event-message.processor';
import { ConsumedMessage } from './types/consumed-message.type';

const event = {
  id: '0b6f3c2e-6c1a-4c55-9a59-1f0d6f2c9b11',
  source: 'producer-b',
  type: 'item.created',
  occurredAt: '2026-11-06T12:00:00.000Z',
  payload: { itemId: 'c1d2e3f4-0000-4000-8000-000000000001' },
};

function sqlError(code: string): QueryFailedError {
  return new QueryFailedError('INSERT ...', [], Object.assign(new Error(`pg ${code}`), { code }));
}

const bug = new TypeError("Cannot read properties of undefined (reading 'id')");

describe('EventMessageProcessor', () => {
  let calls: string[];
  let saveIfNew: jest.Mock;
  let processor: EventMessageProcessor;
  let wait: jest.SpyInstance;
  let warn: jest.SpyInstance;

  function message(value: string | null): ConsumedMessage {
    return {
      topic: 'producer-b.items',
      partition: 1,
      offset: 7n,
      key: event.payload.itemId,
      value,
      commit: jest.fn(() => {
        calls.push('commit');
      }),
    };
  }

  function processMessage(value: string | null): ReturnType<EventMessageProcessor['process']> {
    return processor.process(message(value), new AbortController().signal);
  }

  beforeEach(() => {
    calls = [];
    saveIfNew = jest.fn(() => {
      calls.push('save');
      return Promise.resolve();
    });
    processor = new EventMessageProcessor({ saveIfNew } as unknown as EventsRepository);
    wait = jest.spyOn(processor as unknown as { wait: () => Promise<boolean> }, 'wait').mockResolvedValue(true);
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it('stores a valid event and commits only after it is stored', async () => {
    const outcome = await processMessage(JSON.stringify(event));

    expect(outcome).toBe('stored');
    expect(saveIfNew).toHaveBeenCalledWith(expect.objectContaining({ id: event.id, occurredAt: expect.any(Date) }));
    expect(calls).toEqual(['save', 'commit']);
  });

  it('skips and commits a value that is not JSON, logging where it is and its length but not the value', async () => {
    const value = 'smoke-own-1793980762';

    const outcome = await processMessage(value);

    expect(outcome).toBe('skipped');
    expect(saveIfNew).not.toHaveBeenCalled();
    expect(calls).toEqual(['commit']);
    const [logLine] = warn.mock.calls[0] as [string];
    expect(logLine).toContain('producer-b.items/1@7');
    expect(logLine).toContain(`(key "${event.payload.itemId}")`);
    expect(logLine).toContain('value is not JSON');
    expect(logLine).toContain('SQLSTATE none');
    expect(logLine).toContain(`value length ${value.length} bytes`);
    expect(logLine).not.toContain(value);
  });

  it('skips and commits JSON that is not a valid event', async () => {
    const outcome = await processMessage(JSON.stringify({ id: 'not-a-uuid' }));

    expect(outcome).toBe('skipped');
    expect(saveIfNew).not.toHaveBeenCalled();
    expect(calls).toEqual(['commit']);
  });

  it('skips and commits an event the database rejects for its data (22P02), logging the SQLSTATE and not the value', async () => {
    saveIfNew.mockRejectedValueOnce(sqlError('22P02'));
    const value = JSON.stringify(event);

    const outcome = await processMessage(value);

    expect(outcome).toBe('skipped');
    expect(saveIfNew).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(calls).toEqual(['commit']);
    const [logLine] = warn.mock.calls[0] as [string];
    expect(logLine).toContain('SQLSTATE 22P02');
    expect(logLine).toContain(`value length ${Buffer.byteLength(value)} bytes`);
    expect(logLine).not.toContain(event.id);
  });

  it('commits a duplicate as already stored', async () => {
    saveIfNew.mockRejectedValueOnce(sqlError('23505'));

    const outcome = await processMessage(JSON.stringify(event));

    expect(outcome).toBe('stored');
    expect(calls).toEqual(['commit']);
  });

  it.each([
    ['a refused connection', Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' })],
    [
      'a database without a pod behind its name',
      Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
    ],
    ['a connection exception (class 08)', sqlError('08006')],
    ['a server shutting down', sqlError('57P01')],
    ['a deadlock', sqlError('40P01')],
    ['a missing table (42P01)', sqlError('42P01')],
    ['an error without a code, such as a bug', bug],
  ])('retries the same message after %s, without committing until it is stored', async (_, error) => {
    saveIfNew.mockRejectedValueOnce(error).mockRejectedValueOnce(error);

    const outcome = await processMessage(JSON.stringify(event));

    expect(outcome).toBe('stored');
    expect(saveIfNew).toHaveBeenCalledTimes(3);
    expect(wait.mock.calls.map(([delay]) => delay)).toEqual([1000, 2000]);
    expect(calls).toEqual(['save', 'commit']);
  });

  it.each([
    ['a missing table (42P01)', sqlError('42P01')],
    ['an error without a code, such as a bug', bug],
  ])('never commits while %s persists', async (_, error) => {
    saveIfNew.mockRejectedValue(error);
    wait.mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);

    const outcome = await processMessage(JSON.stringify(event));

    expect(outcome).toBe('aborted');
    expect(saveIfNew).toHaveBeenCalledTimes(3);
    expect(calls).toEqual([]);
  });

  it('gives up without committing when the consumer shuts down while retrying', async () => {
    saveIfNew.mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    wait.mockResolvedValueOnce(false);

    const outcome = await processMessage(JSON.stringify(event));

    expect(outcome).toBe('aborted');
    expect(calls).toEqual([]);
  });
});

describe('retryDelayMs', () => {
  it('doubles from one second up to thirty', () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000]);
  });
});
