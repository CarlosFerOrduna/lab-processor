import { Logger } from '@nestjs/common';
import { CreateEventDto } from './dto/create-event.dto';
import { EventsController } from './events.controller';
import { EventsService } from './events.service';

describe('EventsController', () => {
  const event: CreateEventDto = {
    id: '0d3f1b5e-8a4c-4f7e-9b2a-1c6d8e0f2a3b',
    source: 'producer-a',
    type: 'message.created',
    occurredAt: new Date('2026-11-06T12:00:00.000Z'),
    payload: { text: 'secret text' },
  };

  let ingest: jest.Mock;
  let log: jest.SpyInstance;
  let controller: EventsController;

  beforeEach(() => {
    ingest = jest.fn().mockResolvedValue(undefined);
    log = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    controller = new EventsController({ ingest } as unknown as EventsService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('logs the id and source of each event received over http, without the payload', async () => {
    await expect(controller.ingest(event)).resolves.toEqual({ id: event.id });

    expect(ingest).toHaveBeenCalledWith(event);
    expect(log).toHaveBeenCalledWith(`Event ${event.id} received over HTTP from producer-a`);
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret text');
  });
});
