import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { JoiValidationPipe } from '../common/pipes/joi-validation.pipe';
import { CreateEventDto, createEventSchema } from './dto/create-event.dto';
import { ListEventsDto, listEventsSchema } from './dto/list-events.dto';
import { EventEntity } from './entities/event.entity';
import { EventsService } from './events.service';

@Controller('events')
export class EventsController {
  constructor(private readonly eventsService: EventsService) {}

  /** Receives an event from a producer. Kafka replaces this endpoint in a later stage. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async ingest(@Body(new JoiValidationPipe(createEventSchema)) event: CreateEventDto): Promise<{ id: string }> {
    await this.eventsService.ingest(event);
    return { id: event.id };
  }

  @Get()
  list(@Query(new JoiValidationPipe(listEventsSchema)) query: ListEventsDto): Promise<EventEntity[]> {
    return this.eventsService.list(query);
  }

  @Get(':id')
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<EventEntity> {
    return this.eventsService.getById(id);
  }
}
