// DV-11: the frontend never logs ad hoc. Every handled error goes through this one function, so
// that wiring Sentry (#36) is a change to this file alone.
//
// SC-15: no personal data in logs or error reports. Callers pass the error and a `where` label
// (a route or component name), never user input, headers, tokens or response bodies. Only the
// error's name and message are reported: never its stack, `cause` or any attached payload.

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
  // eslint-disable-next-line no-console -- TODO(#36): send to Sentry (scrubbed) instead
  console.error(`[${where}] ${name}: ${message}`);
}
