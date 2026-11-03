import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

/** The part of a pg client the runner uses. */
export interface MigrationClient {
  connect(): Promise<unknown>;
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

const MIGRATION_LOCK_KEY = 7_340_215;

/** Applies the versioned SQL migrations of a directory to PostgreSQL, in file name order. */
export class PostgresMigrationRunner {
  constructor(
    private readonly client: MigrationClient,
    private readonly migrationsDirectory: string,
  ) {}

  /** Applies the pending migrations and returns their versions. */
  async run(): Promise<string[]> {
    await this.client.connect();
    try {
      // Cada réplica corre su propio runner: el lock deja migrar a uno solo y los demás esperan su turno.
      await this.client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      await this.client.query(
        'CREATE TABLE IF NOT EXISTS schema_migration (version varchar(255) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), CONSTRAINT pk_schema_migration PRIMARY KEY (version))',
      );
      const applied = await this.client.query('SELECT version FROM schema_migration');
      const appliedVersions = new Set(applied.rows.map((row) => String(row.version)));
      const versions = await this.listVersions();
      const pendingVersions = versions.filter((version) => !appliedVersions.has(version));

      for (const version of pendingVersions) {
        await this.apply(version);
      }

      return pendingVersions;
    } finally {
      // Cerrar la sesión libera el advisory lock, aunque una migración haya fallado.
      await this.client.end();
    }
  }

  private async apply(version: string): Promise<void> {
    const sql = await readFile(join(this.migrationsDirectory, version), 'utf8');
    await this.client.query('BEGIN');
    try {
      await this.client.query(sql);
      await this.client.query('INSERT INTO schema_migration (version) VALUES ($1)', [version]);
      await this.client.query('COMMIT');
    } catch (error) {
      await this.client.query('ROLLBACK');
      throw error;
    }
  }

  private async listVersions(): Promise<string[]> {
    const fileNames = await readdir(this.migrationsDirectory);
    return fileNames.filter((fileName) => fileName.endsWith('.sql')).sort();
  }
}
