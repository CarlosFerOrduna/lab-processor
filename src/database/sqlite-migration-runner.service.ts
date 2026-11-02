import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Applies the versioned SQL migrations of a directory to a SQLite database, in file name order. */
export class SqliteMigrationRunner {
  constructor(
    private readonly databasePath: string,
    private readonly migrationsDirectory: string,
  ) {}

  /** Applies the pending migrations and returns their versions. */
  run(): string[] {
    if (this.databasePath !== ':memory:') {
      mkdirSync(dirname(this.databasePath), { recursive: true });
    }

    const database = new Database(this.databasePath);
    try {
      database.exec(
        'CREATE TABLE IF NOT EXISTS schema_migration (version VARCHAR(255) NOT NULL PRIMARY KEY, applied_at DATETIME NOT NULL)',
      );
      const appliedVersions = new Set(
        database.prepare('SELECT version FROM schema_migration').pluck().all() as string[],
      );
      const pendingVersions = this.listVersions().filter((version) => !appliedVersions.has(version));

      for (const version of pendingVersions) {
        const sql = readFileSync(join(this.migrationsDirectory, version), 'utf8');
        const applyMigration = database.transaction(() => {
          database.exec(sql);
          database
            .prepare('INSERT INTO schema_migration (version, applied_at) VALUES (?, ?)')
            .run(version, new Date().toISOString());
        });
        applyMigration();
      }

      return pendingVersions;
    } finally {
      database.close();
    }
  }

  private listVersions(): string[] {
    return readdirSync(this.migrationsDirectory)
      .filter((fileName) => fileName.endsWith('.sql'))
      .sort();
  }
}
