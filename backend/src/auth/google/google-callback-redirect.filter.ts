import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { ApiExceptionFilter } from '../../common/errors/api-exception.filter.js';
import type { ErrorCode } from '../../common/errors/codes.js';
import { DomainError } from '../../common/errors/domain-error.js';
import type { Env } from '../../config/env.js';
import type { GoogleFlowRequest } from './google-oauth-state.store.js';

// What passport raises when Google refuses or rejects the exchange (the person said no, or the
// authorisation code was already used): the person's problem, not a fault of ours.
const OAUTH_REFUSALS = new Set(['AuthorizationError', 'TokenError']);

/**
 * The Google callback is a browser navigation, so a failure cannot be a JSON body: it sends the
 * browser to the sign-in page with the error code (and nothing else: no email, no name, no token)
 * for the page to turn into a message (AR-39, BR-001-08). The code is the one the API would have
 * answered with; a fault of ours is logged and reported exactly as everywhere else (SC-15).
 */
@Catch()
export class GoogleCallbackRedirectFilter implements ExceptionFilter {
  private readonly api = new ApiExceptionFilter();

  constructor(private readonly config: ConfigService<Env, true>) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<GoogleFlowRequest>();
    const code = this.codeFor(exception, request);
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true }); // AR-42
    // SPEC-010 BR-010-13: a failed re-authentication goes back to the privacy page the person was
    // on, not to the sign-in (they are signed in). Only the sealed cookie of the start says so.
    const target =
      request.googleFlowIntent === 'reauth'
        ? `/profile/privacidade?reauthError=${encodeURIComponent(code)}`
        : `/login?error=${encodeURIComponent(code)}`;
    http.getResponse<Response>().redirect(`${frontendUrl}${target}`);
  }

  private codeFor(exception: unknown, request: Request): ErrorCode {
    if (exception instanceof Error && OAUTH_REFUSALS.has(exception.name)) {
      return 'GOOGLE_SIGN_IN_FAILED';
    }
    const { code } = this.api.toBody(exception, request);
    // Passport's own 401 (no profile came back) is not "your session expired" here.
    if (code === 'UNAUTHENTICATED' && !(exception instanceof DomainError)) {
      return 'GOOGLE_SIGN_IN_FAILED';
    }
    return code;
  }
}
