import { Logger } from '@nestjs/common';
import { join } from 'node:path';
import { Client } from 'pg';
import { databaseEnvValidationSchema } from './config/env-validation.schema';
import { PostgresMigrationRunner } from './database/postgres-migration-runner.service';

const MIGRATIONS_DIRECTORY = join(__dirname, '..', 'migrations', 'postgres');
const logger = new Logger('Migrate');

async function migrate(): Promise<void> {
  const validation = databaseEnvValidationSchema.validate(process.env, { allowUnknown: true });
  if (validation.error) {
    throw validation.error;
  }

  const env = validation.value;
  const client = new Client({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
  });
  const appliedVersions = await new PostgresMigrationRunner(client, MIGRATIONS_DIRECTORY).run();
  logger.log(appliedVersions.length > 0 ? `Applied ${appliedVersions.join(', ')}` : 'The database is up to date');
}

migrate().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
