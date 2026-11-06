/** Helpers to describe errors whose real reason is nested in causes and AggregateErrors. */
export class ErrorCausesUtil {
  private static readonly maxDepth = 10;

  /**
   * The error and its distinct root causes, on one line. Kafka clients nest the real reason (a refused
   * connection, a certificate that does not match the host) several AggregateErrors deep, past what
   * Node prints for an uncaught error.
   */
  static describe(error: unknown): string {
    const top = ErrorCausesUtil.format(error);
    const causes = new Set<string>();
    ErrorCausesUtil.collectRootCauses(error, causes, 0);
    causes.delete(top);
    return causes.size > 0 ? `${top} <- ${[...causes].join(' | ')}` : top;
  }

  private static collectRootCauses(error: unknown, causes: Set<string>, depth: number): void {
    const nested = ErrorCausesUtil.nestedErrorsOf(error);
    if (nested.length === 0 || depth >= ErrorCausesUtil.maxDepth) {
      causes.add(ErrorCausesUtil.format(error));
      return;
    }
    for (const inner of nested) {
      ErrorCausesUtil.collectRootCauses(inner, causes, depth + 1);
    }
  }

  private static nestedErrorsOf(error: unknown): unknown[] {
    const { errors, cause } = (error ?? {}) as { errors?: unknown; cause?: unknown };
    const aggregated = Array.isArray(errors) ? errors : [];
    return cause === undefined ? aggregated : [...aggregated, cause];
  }

  private static format(error: unknown): string {
    if (!(error instanceof Error)) {
      return String(error);
    }
    const { code } = error as { code?: unknown };
    return `${error.name}${typeof code === 'string' ? `[${code}]` : ''}: ${error.message}`;
  }
}
