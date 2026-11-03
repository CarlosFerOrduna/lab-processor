import { ServiceUnavailableException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let query: jest.Mock;
  let controller: HealthController;

  beforeEach(() => {
    query = jest.fn();
    controller = new HealthController({ query } as unknown as DataSource);
  });

  it('reports the process as up without touching the database', () => {
    expect(controller.check()).toEqual({ status: 'ok' });
    expect(query).not.toHaveBeenCalled();
  });

  it('is ready when the database answers', async () => {
    query.mockResolvedValue([{ '?column?': 1 }]);

    await expect(controller.ready()).resolves.toEqual({ status: 'ok' });
  });

  it('is not ready when the database fails', async () => {
    query.mockRejectedValue(new Error('connection refused'));

    await expect(controller.ready()).rejects.toThrow(ServiceUnavailableException);
  });

  it('is not ready when the database does not answer in time', async () => {
    jest.useFakeTimers();
    query.mockReturnValue(new Promise(() => undefined));

    const readiness = controller.ready();
    await jest.advanceTimersByTimeAsync(1000);

    await expect(readiness).rejects.toThrow(ServiceUnavailableException);
    jest.useRealTimers();
  });
});
