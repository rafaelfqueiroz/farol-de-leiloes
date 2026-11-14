// AR-46: the per-request correlation id. An incoming x-request-id (from the frontend's BFF or a
// proxy) is kept only when it matches a strict pattern, so a client cannot inject arbitrary text,
// newlines or personal data into every log line; otherwise the API mints a UUID. The id is echoed
// in the response header and opens the request's log context (log-context.ts).
import { randomUUID } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';
import { runWithLogContext } from './log-context.js';

export const REQUEST_ID_HEADER = 'x-request-id';

/** Letters, digits and dashes, 8 to 64 characters: a UUID, a ULID, a hex trace id. */
export const SAFE_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

interface RequestLike {
  id?: unknown;
  headers: IncomingHttpHeaders;
}

interface ResponseLike {
  setHeader(name: string, value: string): unknown;
}

function isSafe(value: unknown): value is string {
  return typeof value === 'string' && SAFE_REQUEST_ID.test(value);
}

/**
 * The request's correlation id: the one already assigned, else a safe incoming x-request-id,
 * else a new UUID. Idempotent, so pino-http's `genReqId` and the middleware agree whichever runs
 * first. Sets `req.id` and the response header.
 */
export function resolveRequestId(req: RequestLike, res: ResponseLike): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id = isSafe(req.id) ? req.id : isSafe(incoming) ? incoming : randomUUID();
  req.id = id;
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/** Express middleware: everything downstream of it runs in the request's log context. */
export function requestContextMiddleware(
  req: RequestLike,
  res: ResponseLike,
  next: () => void,
): void {
  runWithLogContext({ correlationId: resolveRequestId(req, res) }, next);
}
