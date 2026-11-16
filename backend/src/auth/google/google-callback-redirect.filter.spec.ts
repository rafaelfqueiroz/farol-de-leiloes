// BR-001-08, BR-001-20: a failed Google callback redirects to the sign-in page with the error code
// and nothing else; it never answers JSON and never carries personal data or a credential.
import { describe, expect, it, vi } from 'vitest';
import { HttpException, HttpStatus, UnauthorizedException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { GoogleCallbackRedirectFilter } from './google-callback-redirect.filter.js';
import { DomainError } from '../../common/errors/domain-error.js';
import type { Env } from '../../config/env.js';
import { expectNoneLogged, spyOnLogger } from '../../../test/support/logger-spy.js';

function run(exception: unknown) {
  const redirect = vi.fn();
  const config = { get: () => 'https://app.example.test' } as unknown as ConfigService<Env, true>;
  const host = {
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', route: { path: '/auth/google/callback' } }),
      getResponse: () => ({ redirect }),
    }),
  } as unknown as ArgumentsHost;
  new GoogleCallbackRedirectFilter(config).catch(exception, host);
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

  it('SC-15: a fault of ours redirects as INTERNAL_ERROR and is logged by class, never by message', () => {
    const log = spyOnLogger();

    const redirect = run(new Error('boom for ana@example.test'));

    expect(redirect).toHaveBeenCalledWith('https://app.example.test/login?error=INTERNAL_ERROR');
    expectNoneLogged(log.loggedText(), ['ana@example.test', 'boom']);
  });
});
