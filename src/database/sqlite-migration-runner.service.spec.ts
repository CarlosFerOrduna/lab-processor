import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SqliteMigrationRunner } from './sqlite-migration-runner.service';

describe('SqliteMigrationRunner', () => {
  let workDirectory: string;
  let migrationsDirectory: string;
  let databasePath: string;

  beforeEach(() => {
    workDirectory = mkdtempSync(join(tmpdir(), 'migration-runner-'));
    migrationsDirectory = join(workDirectory, 'migrations');
    databasePath = join(workDirectory, 'data', 'test.sqlite');
    mkdirSync(migrationsDirectory);
  });

  afterEach(() => {
    rmSync(workDirectory, { recursive: true, force: true });
  });

  function writeMigration(fileName: string, sql: string): void {
    writeFileSync(join(migrationsDirectory, fileName), sql);
  }

  function runMigrations(): string[] {
    return new SqliteMigrationRunner(databasePath, migrationsDirectory).run();
  }

  it('applies pending migrations in file name order', () => {
    writeMigration('0002_add_index.sql', 'CREATE INDEX ix_item_name ON item (name);');
    writeMigration('0001_create_item.sql', 'CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL);');

    expect(runMigrations()).toEqual(['0001_create_item.sql', '0002_add_index.sql']);
  });

  it('skips migrations that were already applied', () => {
    writeMigration('0001_create_item.sql', 'CREATE TABLE item (id INTEGER PRIMARY KEY, name TEXT NOT NULL);');
    runMigrations();

    expect(runMigrations()).toEqual([]);
  });

  it('rolls back a failing migration and does not record it', () => {
    writeMigration('0001_broken.sql', 'CREATE TABLE item (id INTEGER PRIMARY KEY); INSERT INTO missing VALUES (1);');

    expect(() => runMigrations()).toThrow();

    const database = new Database(databasePath);
    const tables = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all();
    const appliedVersions = database.prepare('SELECT version FROM schema_migration').pluck().all();
    database.close();
    expect(tables).toEqual(['schema_migration']);
    expect(appliedVersions).toEqual([]);
  });
});
