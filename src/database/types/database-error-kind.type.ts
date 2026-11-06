/**
 * How a consumer that cannot answer a client treats a failed database operation:
 * - poison: the message itself is at fault and would fail the same way every time;
 * - duplicate: the row is already stored;
 * - retry: anything else (the database is unreachable, restarting or busy, the schema is missing,
 *   or a bug). Retrying never loses a message; skipping on an error the message did not cause would.
 */
export type DatabaseErrorKind = 'poison' | 'duplicate' | 'retry';
