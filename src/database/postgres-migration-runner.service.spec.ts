import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MigrationClient, PostgresMigrationRunner } from './postgres-migration-runner.service';

class FakeClient implements MigrationClient {
  readonly queries: string[] = [];
  appliedVersions: string[] = [];
  failingSql?: string;
  ended = false;

  async connect(): Promise<void> {}

  async query(sql: string): Promise<{ rows: Record<string, unknown>[] }> {
    this.queries.push(sql);
    if (sql === this.failingSql) {
      throw new Error('migration failed');
    }
    if (sql === 'SELECT version FROM schema_migration') {
      return { rows: this.appliedVersions.map((version) => ({ version })) };
    }
    return { rows: [] };
  }

  async end(): Promise<void> {
    this.ended = true;
  }
}

describe('PostgresMigrationRunner', () => {
  let migrationsDirectory: string;
  let client: FakeClient;

  beforeEach(() => {
    migrationsDirectory = mkdtempSync(join(tmpdir(), 'migrations-'));
    writeFileSync(join(migrationsDirectory, '0002_add_index.sql'), 'CREATE INDEX ix_item_name ON item (name);');
    writeFileSync(join(migrationsDirectory, '0001_create_item.sql'), 'CREATE TABLE item (id uuid);');
    client = new FakeClient();
  });

  afterEach(() => {
    rmSync(migrationsDirectory, { recursive: true, force: true });
  });

  function runMigrations(): Promise<string[]> {
    return new PostgresMigrationRunner(client, migrationsDirectory).run();
  }

  it('takes the migration lock before reading what was applied', async () => {
    await runMigrations();

    expect(client.queries[0]).toBe('SELECT pg_advisory_lock($1)');
  });

  it('applies each pending migration in its own transaction, in file name order', async () => {
    const appliedVersions = await runMigrations();

    expect(appliedVersions).toEqual(['0001_create_item.sql', '0002_add_index.sql']);
    const firstMigration = client.queries.indexOf('CREATE TABLE item (id uuid);');
    expect(client.queries.slice(firstMigration - 1, firstMigration + 3)).toEqual([
      'BEGIN',
      'CREATE TABLE item (id uuid);',
      'INSERT INTO schema_migration (version) VALUES ($1)',
      'COMMIT',
    ]);
    expect(client.ended).toBe(true);
  });

  it('skips migrations that were already applied', async () => {
    client.appliedVersions = ['0001_create_item.sql'];

    await expect(runMigrations()).resolves.toEqual(['0002_add_index.sql']);
  });

  it('rolls back a failing migration, stops, and closes the session', async () => {
    client.failingSql = 'CREATE TABLE item (id uuid);';

    await expect(runMigrations()).rejects.toThrow('migration failed');
    expect(client.queries).toContain('ROLLBACK');
    expect(client.queries).not.toContain('CREATE INDEX ix_item_name ON item (name);');
    expect(client.ended).toBe(true);
  });
});
