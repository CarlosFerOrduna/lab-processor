import { sqliteUtcToIso, toPostgresEventValues } from './sqlite-event-row.util';

describe('sqlite event rows', () => {
  const row = {
    id: '0b6f3c2e-6c1a-4c55-9a59-1f0d6f2c9b11',
    source: 'producer-a',
    type: 'message.created',
    payload: '{"text":"hello"}',
    occurred_at: '2026-11-02 18:00:00.040',
    created_at: '2026-11-02 18:00:01',
  };

  it('reads SQLite timestamps as UTC', () => {
    expect(sqliteUtcToIso('2026-11-02 18:00:00.040')).toBe('2026-11-02T18:00:00.040Z');
    expect(sqliteUtcToIso('2026-11-02 18:00:01')).toBe('2026-11-02T18:00:01.000Z');
  });

  it('maps a row to PostgreSQL values in column order', () => {
    expect(toPostgresEventValues(row)).toEqual([
      row.id,
      'producer-a',
      'message.created',
      '{"text":"hello"}',
      '2026-11-02T18:00:00.040Z',
      '2026-11-02T18:00:01.000Z',
    ]);
  });

  it('fails on a corrupt payload or timestamp instead of copying it', () => {
    expect(() => toPostgresEventValues({ ...row, payload: '{broken' })).toThrow();
    expect(() => toPostgresEventValues({ ...row, created_at: 'yesterday' })).toThrow('Invalid SQLite timestamp');
  });
});
