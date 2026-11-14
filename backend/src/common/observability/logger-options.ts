// AR-45/AR-46: the nestjs-pino configuration behind every NestJS Logger. JSON lines on stdout,
// each carrying the log context (correlationId, jobName, userHash) through pino's `mixin`.
//
// SC-15: a request's completion line holds the method, the route pattern (or the path without
// its query string when no route matched), the status code and the response time. Headers, cookies, bodies,
// query strings and the client address are never serialized; the `redact` list removes them again
// should any other code path attach them, and removes the fields that name a person.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';
import { stdTimeFunctions, type LevelWithSilent, type LogFn, type Logger } from 'pino';
import { logContextFields } from './log-context.js';
import { resolveRequestId } from './request-context.js';

export const HEALTH_PATH = '/api/health';

/** Defence in depth (SC-15): removed wherever they appear, at the top level or one level down. */
export const REDACT_PATHS = [
  'req.headers',
  'req.query',
  'req.params',
  'req.body',
  'req.remoteAddress',
  'req.remotePort',
  'res.headers',
  ...['headers', 'cookie', 'cookies', 'authorization', 'body', 'query'].flatMap((key) => [
    key,
    `*.${key}`,
  ]),
  ...['email', 'name', 'phone', 'cpf', 'password', 'token'].flatMap((key) => [key, `*.${key}`]),
];

/** What Express leaves on a request once a route matched. */
interface RoutedRequest extends IncomingMessage {
  originalUrl?: string;
  route?: { path?: unknown };
}

/** The request path without its query string or fragment. */
export function pathOf(req: RoutedRequest): string {
  const url = req.originalUrl ?? req.url ?? '';
  return url.split(/[?#]/, 1)[0] ?? '';
}

/**
 * The matched route pattern (`/api/auctions/:code`), else the path without its query string.
 * Read when the response finishes: by then `req.route` is the handler's route. A wildcard pattern
 * is the logger middleware's own mount (`/api{/*splat}`), left there when no handler matched.
 */
export function routeOf(req: RoutedRequest): string {
  const pattern = req.route?.path;
  return typeof pattern === 'string' && !pattern.includes('*') ? pattern : pathOf(req);
}

/**
 * pino-http hands serializers its own wrapper; the Node request is on `raw`. Only the method: the
 * request is bound when it arrives, before any route matched, so the route goes on the completion
 * line instead (completionObject).
 */
export function serializeRequest(req: { raw: RoutedRequest }): { method?: string } {
  return { method: req.raw.method };
}

export function serializeResponse(res: { statusCode?: number }): { statusCode?: number } {
  return { statusCode: res.statusCode };
}

const STACK_FRAME = /^\s*at /;

/**
 * A stack without its message: the lines before the first frame. Same rule as the
 * ApiExceptionFilter (SC-15): a message may quote a value (a duplicate-key error names the email
 * it collided on), and it may span several lines.
 */
export function stackFrames(stack: string): string {
  const lines = stack.split('\n');
  const first = lines.findIndex((line) => STACK_FRAME.test(line));
  return first === -1 ? '' : lines.slice(first).join('\n');
}

/**
 * An error's class and stack frames only (SC-15): no message, and none of the enumerable
 * properties pino's standard serializer copies, such as a duplicate-key error's `keyValue`.
 */
export function serializeError(value: unknown): { type: string; stack?: string } {
  // pino-http hands serializers pino's own serialized error, with the original on `raw`.
  const raw = (value as { raw?: unknown } | null | undefined)?.raw;
  const error = raw instanceof Error ? raw : value;
  if (!(error instanceof Error)) return { type: typeof error };
  const type = error.constructor.name;
  return error.stack === undefined ? { type } : { type, stack: stackFrames(error.stack) };
}

/**
 * The `msg` of a line logged with only an error: pino would use the error's message. It is the
 * class name instead (SC-15), unless the stack starts with a frame — then nestjs-pino built the
 * error itself from a `logger.error(message, stack)` call, and the message is the text our code
 * wrote (`Unhandled Error on GET /api/...`).
 */
export function errorLineMessage(error: Error): string {
  const [first] = (error.stack ?? '').split('\n', 1);
  return first !== undefined && STACK_FRAME.test(first) ? error.message : error.constructor.name;
}

/**
 * pino `logMethod` hook: a call with an error and no message (`logger.error(error)`, as
 * @nestjs/schedule logs a failed cron; trailing `undefined`s count as none) gets errorLineMessage as its message, so the error's own
 * message never reaches the line.
 */
export function logMethod(this: Logger, args: Parameters<LogFn>, method: LogFn): void {
  const [first, ...rest] = args as unknown[];
  // Nest's Logger passes an `undefined` stack along with an error (`logger.error(error)`).
  const noMessage = rest.every((arg) => arg === undefined);
  if (noMessage && typeof first === 'object' && first !== null) {
    const error = first instanceof Error ? first : (first as { err?: unknown }).err;
    if (error instanceof Error) {
      const fields = first instanceof Error ? { err: first } : first;
      method.call(this, fields, errorLineMessage(error));
      return;
    }
  }
  (method as (...a: unknown[]) => void).apply(this, args);
}

/**
 * 5xx is an error someone must look at, 4xx a warning, the rest operational (AR-45). A
 * successful health probe is `silent`: the container calls it every 30 s, and a line per probe is
 * noise; a failing one (503) still logs.
 */
export function requestLogLevel(
  req: IncomingMessage,
  res: ServerResponse,
  error?: Error,
): LevelWithSilent {
  if (error || res.statusCode >= 500) return 'error';
  if (res.statusCode >= 400) return 'warn';
  if (res.statusCode >= 200 && res.statusCode < 300 && pathOf(req) === HEALTH_PATH) {
    return 'silent';
  }
  return 'info';
}

/**
 * The completion line: pino-http's `res` and `responseTime`, plus the route (matched by now) and
 * the request's id. The id goes in explicitly because the line is written when the response
 * finishes, which may happen outside the request's async context; a merge-object key wins over
 * the same mixin key, so the JSON never holds it twice.
 */
export function completionObject(req: IncomingMessage, value: object): object {
  return { ...value, route: routeOf(req), correlationId: String(req.id) };
}

function successObject(req: IncomingMessage, _res: ServerResponse, value: object): object {
  return completionObject(req, value);
}

function errorObject(
  req: IncomingMessage,
  _res: ServerResponse,
  _error: Error,
  value: object,
): object {
  return completionObject(req, value);
}

export function loggerParams(level: LevelWithSilent): Params {
  return {
    pinoHttp: {
      level,
      timestamp: stdTimeFunctions.isoTime,
      mixin: logContextFields,
      hooks: { logMethod },
      redact: { paths: REDACT_PATHS, remove: true },
      // req.id is set by requestContextMiddleware first; this only covers a request that reached
      // pino-http without it.
      genReqId: resolveRequestId,
      serializers: { req: serializeRequest, res: serializeResponse, err: serializeError },
      customLogLevel: requestLogLevel,
      customSuccessMessage: () => 'request completed',
      customErrorMessage: () => 'request failed',
      customSuccessObject: successObject,
      customErrorObject: errorObject,
    },
  };
}
