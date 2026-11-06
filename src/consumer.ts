import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { ConsumerModule } from './consumer/consumer.module';

// Corre en su propio Deployment y solo expone GET /health: lo necesita su liveness probe.
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(ConsumerModule);
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);
}

void bootstrap();
