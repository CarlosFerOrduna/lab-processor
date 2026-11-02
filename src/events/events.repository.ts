import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { CreateEventDto } from './dto/create-event.dto';
import { ListEventsDto } from './dto/list-events.dto';
import { EventEntity } from './entities/event.entity';

@Injectable()
export class EventsRepository extends Repository<EventEntity> {
  constructor(dataSource: DataSource) {
    super(EventEntity, dataSource.createEntityManager());
  }

  /** Stores the event unless one with the same id exists, so a producer can safely retry. */
  async saveIfNew(event: CreateEventDto): Promise<void> {
    await this.createQueryBuilder().insert().values(event).orIgnore().execute();
  }

  /** Returns the most recently received events, optionally from a single source. */
  findLatest({ source, limit, offset }: ListEventsDto): Promise<EventEntity[]> {
    return this.find({
      where: source ? { source } : {},
      order: { createdAt: 'DESC', id: 'ASC' },
      take: limit,
      skip: offset,
    });
  }
}
