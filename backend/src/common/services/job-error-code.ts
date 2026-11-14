// AR-03 / SC-15: a failed run is recorded with a stable code, never the error's message (which may
// quote a value or a URL). A DomainError gives its catalogue code; any other error its class name
// (`MongoServerError`, `TypeError`), kept only when it looks like one.
import { DomainError } from '../errors/domain-error.js';

export const UNKNOWN_JOB_ERROR = 'UNKNOWN_ERROR';

const CLASS_NAME = /^[A-Z][A-Za-z0-9]{0,63}$/;

export function jobErrorCode(error: unknown): string {
  if (error instanceof DomainError) return error.code;
  if (error instanceof Error && CLASS_NAME.test(error.name)) return error.name;
  return UNKNOWN_JOB_ERROR;
}
