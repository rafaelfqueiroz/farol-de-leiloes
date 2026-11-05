// DV-11: the frontend never logs ad hoc. Every handled error goes through this one function, so
// that error reporting is a change to this file alone. AR-47: it reports to Sentry, which is
// inert without a DSN and scrubs every event (lib/sentry-scrubber.ts).
//
// SC-15: no personal data in logs or error reports. Callers pass the error and a `where` label
// (a route or component name), never user input, headers, tokens or response bodies. Only the
// error's name and message are reported: never its stack, `cause` or any attached payload.
import { captureException } from '@sentry/nextjs';

export interface ClientErrorContext {
  /** Where the error was handled, e.g. `api/auth/login POST` or `FavoritesContext.toggle`. */
  where: string;
}

function describe(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name, message: error.message };
  return { name: 'NonError', message: typeof error === 'string' ? error : '' };
}

export function reportClientError(error: unknown, context?: ClientErrorContext): void {
  const { name, message } = describe(error);
  const where = context?.where ?? 'unknown';
  // A fresh Error carries only the name and message; the original stack, cause and extra
  // properties stay behind. `where` is a tag, a fixed label rather than user data.
  const sanitized = new Error(message);
  sanitized.name = name;
  delete sanitized.stack;
  captureException(sanitized, { tags: { where } });
}
