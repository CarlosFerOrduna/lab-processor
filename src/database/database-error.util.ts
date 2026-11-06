import { DATABASE_ERROR } from './constants/database-error.constant';
import { DatabaseErrorKind } from './types/database-error-kind.type';

/** Helpers to tell what a failed PostgreSQL operation means for the message that caused it. */
export class DatabaseErrorUtil {
  private static readonly poisonSqlStateClasses: ReadonlySet<string> = new Set(DATABASE_ERROR.poisonSqlStateClasses);

  /** Only an error caused by the data is poison; a unique violation is a stored row; anything else is retried. */
  static classify(error: unknown): DatabaseErrorKind {
    const sqlState = DatabaseErrorUtil.sqlStateOf(error);
    if (sqlState === DATABASE_ERROR.uniqueViolation) {
      return 'duplicate';
    }
    if (sqlState && DatabaseErrorUtil.poisonSqlStateClasses.has(sqlState.slice(0, 2))) {
      return 'poison';
    }
    return 'retry';
  }

  /** The five-character SQLSTATE of a PostgreSQL error, also when TypeORM wraps it. */
  static sqlStateOf(error: unknown): string | undefined {
    for (const candidate of [error, DatabaseErrorUtil.driverErrorOf(error)]) {
      const code = DatabaseErrorUtil.codeOf(candidate);
      if (code && /^[0-9A-Z]{5}$/.test(code)) {
        return code;
      }
    }
    return undefined;
  }

  private static codeOf(error: unknown): string | undefined {
    const code = (error as { code?: unknown } | null | undefined)?.code;
    return typeof code === 'string' ? code : undefined;
  }

  private static driverErrorOf(error: unknown): unknown {
    return (error as { driverError?: unknown } | null | undefined)?.driverError;
  }
}
