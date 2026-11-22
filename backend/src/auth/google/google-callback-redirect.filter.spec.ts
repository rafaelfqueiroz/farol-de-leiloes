// BR-001-08, BR-001-20: a failed Google callback redirects to the sign-in page with the error code
// and nothing else; it never answers JSON and never carries personal data or a credential.
import { describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GoogleCallbackRedirectFilter } from './google-callback-redirect.filter.js';
import type { GoogleOAuthStateStore } from './google-oauth-state.store.js';
import { DomainError } from '../../common/errors/domain-error.js';
import type { Env } from '../../config/env.js';
import { expectNoneLogged, spyOnLogger } from '../../../test/support/logger-spy.js';

function run(
  exception: unknown,
  googleFlowIntent?: 'reauth',
  /** What the sealed cookie says when `verify` never ran (the callback failed before it). */
  cookieIntent?: 'reauth',
) {
  const redirect = vi.fn();
  const config = { get: () => 'https://app.example.test' } as unknown as ConfigService<Env, true>;
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({
        method: 'GET',
        route: { path: '/auth/google/callback' },
        googleFlowIntent,
      }),
      getResponse: () => ({ redirect }),
    }),
  } as unknown as ArgumentsHost;
  const flows = { flowIntentOf: () => cookieIntent } as unknown as GoogleOAuthStateStore;
  new GoogleCallbackRedirectFilter(config, flows).catch(exception, host);
  return redirect;
}

describe('GoogleCallbackRedirectFilter', () => {
  it('BR-001-08: a DomainError redirects to the sign-in page with its code, only', () => {
    expect(
      run(new DomainError('GOOGLE_EMAIL_NOT_VERIFIED', { email: 'x@y.test' })),
    ).toHaveBeenCalledWith('https://app.example.test/login?error=GOOGLE_EMAIL_NOT_VERIFIED');
  });

  it.each([['AuthorizationError'], ['TokenError']])(
    'Google refusing the consent or the code (%s) is GOOGLE_SIGN_IN_FAILED',
    (name) => {
      const error = Object.assign(new Error('access_denied: a@b.test'), { name });

      expect(run(error)).toHaveBeenCalledWith(
        'https://app.example.test/login?error=GOOGLE_SIGN_IN_FAILED',
      );
    },
  );

  it('passport answering 401 because no profile came back is GOOGLE_SIGN_IN_FAILED, not an expired session', () => {
    expect(run(new UnauthorizedException())).toHaveBeenCalledWith(
      'https://app.example.test/login?error=GOOGLE_SIGN_IN_FAILED',
    );
  });

  it('keeps the code of any other client error', () => {
    expect(run(new HttpException('no', HttpStatus.TOO_MANY_REQUESTS))).toHaveBeenCalledWith(
      'https://app.example.test/login?error=TOO_MANY_REQUESTS',
    );
  });

  it('SPEC-010 BR-010-13: a failed re-authentication goes back to the privacy page, not to the sign-in', () => {
    expect(run(new DomainError('GOOGLE_SIGN_IN_FAILED'), 'reauth')).toHaveBeenCalledWith(
      'https://app.example.test/profile/privacidade?reauthError=GOOGLE_SIGN_IN_FAILED',
    );
  });

  it('SPEC-010 BR-010-13: Google refusing a re-authentication (access_denied) goes back to the privacy page, told by the sealed cookie', () => {
    const denied = Object.assign(new Error('access_denied'), { name: 'AuthorizationError' });

    // `verify` never ran, so only the cookie of the start knows it was a re-authentication
    expect(run(denied, undefined, 'reauth')).toHaveBeenCalledWith(
      'https://app.example.test/profile/privacidade?reauthError=GOOGLE_SIGN_IN_FAILED',
    );
  });

  it('a refusal with no re-authentication cookie (an ordinary sign-in, or a cookie that is not ours) still goes to the login', () => {
    const denied = Object.assign(new Error('access_denied'), { name: 'AuthorizationError' });

    expect(run(denied)).toHaveBeenCalledWith(
      'https://app.example.test/login?error=GOOGLE_SIGN_IN_FAILED',
    );
  });

  it('SC-15: a fault of ours redirects as INTERNAL_ERROR and is logged by class, never by message', () => {
    const log = spyOnLogger();

    const redirect = run(new Error('boom for ana@example.test'));

    expect(redirect).toHaveBeenCalledWith('https://app.example.test/login?error=INTERNAL_ERROR');
    expectNoneLogged(log.loggedText(), ['ana@example.test', 'boom']);
  });
});
