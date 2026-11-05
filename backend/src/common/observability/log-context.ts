// AR-46: every log line carries a request or job correlation id, and a signed-in user only as a
// hashed id. The context lives in an AsyncLocalStorage, opened once per request
// (request-context.ts) and once per job run (job-context.ts), and pino's `mixin` copies it onto
// every line (logger-options.ts). No framework import: it is plain Node, unit-tested directly.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface LogContext {
  /** The request id (echoed as x-request-id) or the job run's own id. */
  readonly correlationId: string;
  /** Set for a job run: the job it belongs to, e.g. `auctions-import`. */
  readonly jobName?: string;
  /** SC-15: HMAC of the user id (user-hash.ts), set once the JWT user is known; never the id. */
  userHash?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

/** Runs `fn` with `context` as the current log context, across every `await` inside it. */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return storage.run({ ...context }, fn);
}

export function currentLogContext(): Readonly<LogContext> | undefined {
  return storage.getStore();
}

/**
 * Attaches the hashed user to the current context, for the rest of the request. A no-op outside
 * a context and for an absent hash (no LOG_HASH_SECRET configured: no user id is logged).
 */
export function setLogUserHash(userHash: string | undefined): void {
  const context = storage.getStore();
  if (context && userHash) context.userHash = userHash;
}

/** The fields the current context adds to a log line; none outside a context. */
export function logContextFields(): Record<string, string> {
  const context = storage.getStore();
  if (!context) return {};
  const { correlationId, jobName, userHash } = context;
  return {
    correlationId,
    ...(jobName === undefined ? {} : { jobName }),
    ...(userHash === undefined ? {} : { userHash }),
  };
}
