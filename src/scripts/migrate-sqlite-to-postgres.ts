import { Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import Joi from 'joi';
import { Client } from 'pg';
import { databaseEnvValidationSchema } from '../config/env-validation.schema';
import { SqliteEventRow, toPostgresEventValues } from './sqlite-event-row.util';

const logger = new Logger('MigrateSqliteToPostgres');

const scriptEnvValidationSchema = databaseEnvValidationSchema.keys({
  SQLITE_DATABASE_PATH: Joi.string().required(),
});

/**
 * Copies every event from the old SQLite file into PostgreSQL and checks that none is missing.
 * Safe to run again: rows that already exist in PostgreSQL are skipped, never duplicated.
 */
async function migrateSqliteToPostgres(): Promise<void> {
  const validation = scriptEnvValidationSchema.validate(process.env, { allowUnknown: true });
  if (validation.error) {
    throw validation.error;
  }
  const env = validation.value;

  const sqlite = new Database(env.SQLITE_DATABASE_PATH, { readonly: true, fileMustExist: true });
  const rows = sqlite.prepare('SELECT * FROM event ORDER BY created_at, id').all() as SqliteEventRow[];
  sqlite.close();

  const postgres = new Client({
    host: env.DATABASE_HOST,
    port: env.DATABASE_PORT,
    database: env.DATABASE_NAME,
    user: env.DATABASE_USER,
    password: env.DATABASE_PASSWORD,
  });
  await postgres.connect();
  try {
    let insertedCount = 0;
    await postgres.query('BEGIN');
    try {
      for (const row of rows) {
        const result = await postgres.query(
          'INSERT INTO event (id, source, type, payload, occurred_at, created_at) VALUES ($1, $2, $3, $4::jsonb, $5, $6) ON CONFLICT (id) DO NOTHING',
          toPostgresEventValues(row),
        );
        insertedCount += result.rowCount ?? 0;
      }
      await postgres.query('COMMIT');
    } catch (error) {
      await postgres.query('ROLLBACK');
      throw error;
    }

    const sqliteIds = rows.map((row) => row.id);
    const found = await postgres.query<{ count: string }>(
      'SELECT count(*) AS count FROM event WHERE id = ANY($1::uuid[])',
      [sqliteIds],
    );
    const foundCount = Number(found.rows[0].count);
    if (foundCount !== rows.length) {
      throw new Error(`Only ${foundCount} of ${rows.length} SQLite events are in PostgreSQL`);
    }

    logger.log(
      `Read ${rows.length} events from SQLite: inserted ${insertedCount}, already present ${rows.length - insertedCount}. All ${foundCount} are in PostgreSQL.`,
    );
  } finally {
    await postgres.end();
  }
}

migrateSqliteToPostgres().catch((error: unknown) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
