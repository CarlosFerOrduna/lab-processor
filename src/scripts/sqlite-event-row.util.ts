/** A row of the event table as SQLite stored it: JSON as text and UTC timestamps without a zone. */
export interface SqliteEventRow {
  id: string;
  source: string;
  type: string;
  payload: string;
  occurred_at: string;
  created_at: string;
}

/** Values for an INSERT into the PostgreSQL event table, in column order. */
export type PostgresEventValues = [string, string, string, string, string, string];

/** Turns a SQLite timestamp (`2026-11-02 18:00:00.000`, always UTC) into ISO 8601 with an explicit zone. */
export function sqliteUtcToIso(timestamp: string): string {
  const parsed = new Date(`${timestamp.replace(' ', 'T')}Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid SQLite timestamp: ${timestamp}`);
  }

  return parsed.toISOString();
}

/** Maps a SQLite row to PostgreSQL values. Fails on a corrupt payload or timestamp instead of copying it. */
export function toPostgresEventValues(row: SqliteEventRow): PostgresEventValues {
  const payload: unknown = JSON.parse(row.payload);
  return [
    row.id,
    row.source,
    row.type,
    JSON.stringify(payload),
    sqliteUtcToIso(row.occurred_at),
    sqliteUtcToIso(row.created_at),
  ];
}
