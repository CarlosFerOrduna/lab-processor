import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsDto } from './dto/list-events.dto';
import { EventEntity } from './entities/event.entity';
import { EventsRepository } from './events.repository';

@Injectable()
export class EventsService {
  constructor(private readonly eventsRepository: EventsRepository) {}

  async ingest(event: CreateEventDto): Promise<void> {
    await this.eventsRepository.saveIfNew(event);
  }

  list(query: ListEventsDto): Promise<EventEntity[]> {
    return this.eventsRepository.findLatest(query);
  }

  async getById(id: string): Promise<EventEntity> {
    const event = await this.eventsRepository.findOneBy({ id });
    if (!event) {
      throw new NotFoundException(`Event ${id} not found`);
    }

    return event;
  }
}
