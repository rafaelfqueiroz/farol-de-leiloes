// AR-38: the one place an error becomes an HTTP response, always `{ code, context }`.
//   DomainError        → its code, the status from ERROR_STATUS, its context (AR-37, AR-40)
//   built-in HTTP error → a generic code by status (unknown route, passport 401, body too large...)
//   anything else       → logged, answered as a bare 500 INTERNAL_ERROR (ARCHITECTURE §9 faults)
// No message, stack or request value ever reaches the response body (SC-15).
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ErrorCode } from './codes';
import { DomainError, type ErrorContext } from './domain-error';
import { ERROR_STATUS } from './error-status';

export interface ErrorBody {
  code: ErrorCode;
  context: ErrorContext;
}

const CODE_BY_STATUS: Partial<Record<number, ErrorCode>> = {
  [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHENTICATED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.PAYLOAD_TOO_LARGE]: 'PAYLOAD_TOO_LARGE',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const body = this.toBody(exception, http.getRequest<Request>());
    http.getResponse<Response>().status(ERROR_STATUS[body.code]).json(body);
  }

  private toBody(exception: unknown, request: Request): ErrorBody {
    if (exception instanceof DomainError) {
      return { code: exception.code, context: exception.context };
    }
    // body-parser's errors (malformed JSON, entity too large) are not HttpExceptions but carry
    // the status they mean.
    const status =
      exception instanceof HttpException ? exception.getStatus() : clientErrorStatus(exception);
    if (status !== undefined && status < 500) {
      return { code: CODE_BY_STATUS[status] ?? 'BAD_REQUEST', context: {} };
    }
    this.logFault(exception, request);
    return { code: 'INTERNAL_ERROR', context: {} };
  }

  // SC-15: the route pattern, never the URL (it may carry a token or an id the user typed), and
  // the stack without its first line, which repeats the message (a duplicate-key error quotes
  // the email it collided on).
  private logFault(exception: unknown, request: Request): void {
    const route = (request.route as { path?: string } | undefined)?.path ?? '(no route)';
    const name = exception instanceof Error ? exception.name : typeof exception;
    const frames =
      exception instanceof Error ? exception.stack?.split('\n').slice(1).join('\n') : undefined;
    this.logger.error(`Unhandled ${name} on ${request.method} ${route}`, frames);
  }
}

/** The 4xx status of a non-Nest error that declares one (body-parser), if any. */
function clientErrorStatus(exception: unknown): number | undefined {
  if (typeof exception !== 'object' || exception === null) return undefined;
  const { status, expose } = exception as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true
    ? status
    : undefined;
}
