import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { consumerEnvValidationSchema } from '../config/env-validation.schema';
import { DatabaseModule } from '../database/database.module';
import { EventEntity } from '../events/entities/event.entity';
import { EventsRepository } from '../events/events.repository';
import { HealthModule } from '../health/health.module';
import { EventConsumerService } from './event-consumer.service';
import { EventMessageProcessor } from './event-message.processor';

/** The Kafka consumer: no events API, only /health for its liveness probe. */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      ignoreEnvFile: true,
      validationSchema: consumerEnvValidationSchema,
    }),
    DatabaseModule,
    TypeOrmModule.forFeature([EventEntity]),
    HealthModule,
  ],
  providers: [EventsRepository, EventMessageProcessor, EventConsumerService],
})
export class ConsumerModule {}
