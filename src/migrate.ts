import { Logger } from '@nestjs/common';
import { join } from 'node:path';
import { envValidationSchema } from './config/env-validation.schema';
import { SqliteMigrationRunner } from './database/sqlite-migration-runner.service';

const MIGRATIONS_DIRECTORY = join(__dirname, '..', 'migrations', 'sqlite');

function migrate(): void {
  const logger = new Logger('Migrate');
  const validation = envValidationSchema.validate(process.env, { allowUnknown: true });
  if (validation.error) {
    throw validation.error;
  }

  const runner = new SqliteMigrationRunner(validation.value.DATABASE_PATH, MIGRATIONS_DIRECTORY);
  const appliedVersions = runner.run();
  logger.log(appliedVersions.length > 0 ? `Applied ${appliedVersions.join(', ')}` : 'The database is up to date');
}

migrate();
