import { DATABASE_ERROR } from './constants/database-error.constant';
import { DatabaseErrorKind } from './types/database-error-kind.type';

const POISON_SQL_STATE_CLASSES: ReadonlySet<string> = new Set(DATABASE_ERROR.poisonSqlStateClasses);

/** Only an error caused by the data is poison; a unique violation is a stored row; anything else is retried. */
export function classifyDatabaseError(error: unknown): DatabaseErrorKind {
  const sqlState = sqlStateOf(error);
  if (sqlState === DATABASE_ERROR.uniqueViolation) {
    return 'duplicate';
  }
  if (sqlState && POISON_SQL_STATE_CLASSES.has(sqlState.slice(0, 2))) {
    return 'poison';
  }
  return 'retry';
}

/** The five-character SQLSTATE of a PostgreSQL error, also when TypeORM wraps it. */
export function sqlStateOf(error: unknown): string | undefined {
  for (const candidate of [error, driverErrorOf(error)]) {
    const code = codeOf(candidate);
    if (code && /^[0-9A-Z]{5}$/.test(code)) {
      return code;
    }
  }
  return undefined;
}

function codeOf(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null | undefined)?.code;
  return typeof code === 'string' ? code : undefined;
}

function driverErrorOf(error: unknown): unknown {
  return (error as { driverError?: unknown } | null | undefined)?.driverError;
}
