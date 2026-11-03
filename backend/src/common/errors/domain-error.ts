// AR-37: an expected business outcome, carried as a stable code plus structured context, never a
// user-facing sentence. No framework import (AR-05), so `domain/` code may throw it too; the HTTP
// status is api-exception.filter.ts's concern (AR-38).
import type { ErrorCode } from './codes';

/**
 * AR-40: ids, counts, limits and enum values only. Never a name, an email, a phone, free text the
 * user typed or anything else that identifies a person or a client.
 */
export type ErrorContext = Record<string, string | number | boolean | string[]>;

export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly context: ErrorContext = {},
  ) {
    // The message is the code: it is what a log line or a stack trace shows, and it holds no data.
    super(code);
    this.name = 'DomainError';
  }
}
