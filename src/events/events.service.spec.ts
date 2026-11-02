import { NotFoundException } from '@nestjs/common';
import { EventEntity } from './entities/event.entity';
import { EventsRepository } from './events.repository';
import { EventsService } from './events.service';

describe('EventsService', () => {
  const eventId = '0b6f3c2e-6c1a-4c55-9a59-1f0d6f2c9b11';
  let eventsRepository: jest.Mocked<Pick<EventsRepository, 'findOneBy'>>;
  let service: EventsService;

  beforeEach(() => {
    eventsRepository = { findOneBy: jest.fn() };
    service = new EventsService(eventsRepository as unknown as EventsRepository);
  });

  it('returns the event with the given id', async () => {
    const event = Object.assign(new EventEntity(), { id: eventId });
    eventsRepository.findOneBy.mockResolvedValue(event);

    await expect(service.getById(eventId)).resolves.toBe(event);
  });

  it('fails with not found when the event does not exist', async () => {
    eventsRepository.findOneBy.mockResolvedValue(null);

    await expect(service.getById(eventId)).rejects.toThrow(NotFoundException);
  });
});
