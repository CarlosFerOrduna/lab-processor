/** stored: saved (or already there) and committed. skipped: poison, logged and committed. aborted: not committed. */
export type MessageOutcome = 'stored' | 'skipped' | 'aborted';
