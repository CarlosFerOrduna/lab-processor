import { QueryFailedError } from 'typeorm';
import { classifyDatabaseError, sqlStateOf } from './database-error.util';

function pgError(code: string, message = 'error'): Error {
  return Object.assign(new Error(message), { code });
}

function wrapped(driverError: Error): QueryFailedError {
  return new QueryFailedError('INSERT ...', [], driverError);
}

describe('classifyDatabaseError', () => {
  it.each(['22P02', '22001', '22007', '23502', '23503', '23514'])(
    'treats SQLSTATE %s, caused by the data, as poison',
    (code) => {
      expect(classifyDatabaseError(wrapped(pgError(code)))).toBe('poison');
    },
  );

  it('treats a unique violation as an already stored row', () => {
    expect(classifyDatabaseError(wrapped(pgError('23505')))).toBe('duplicate');
  });

  it.each(['08006', '57P01', '57P03', '40001', '40P01', '42P01', '42703', '53300'])(
    'retries SQLSTATE %s, which the message did not cause',
    (code) => {
      expect(classifyDatabaseError(wrapped(pgError(code)))).toBe('retry');
    },
  );

  it.each(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'])(
    'retries the network error %s',
    (code) => {
      expect(classifyDatabaseError(pgError(code))).toBe('retry');
    },
  );

  it('retries an error without a code, such as a bug', () => {
    expect(classifyDatabaseError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe('retry');
    expect(classifyDatabaseError(new Error('Connection terminated unexpectedly'))).toBe('retry');
  });
});

describe('sqlStateOf', () => {
  it('reads the SQLSTATE through a TypeORM QueryFailedError', () => {
    expect(sqlStateOf(wrapped(pgError('22P02')))).toBe('22P02');
  });

  it('ignores network error codes', () => {
    expect(sqlStateOf(pgError('ECONNREFUSED'))).toBeUndefined();
  });
});
