// SPEC-010 BR-010-13, over HTTP: the callback of a Google flow goes where the SEALED cookie of its
// start says. The guard here replays what the real one does with the real GoogleOAuthStateStore
// (verify the state against the cookie, then set the Google identity); the real strategy would call
// Google. The controller, the redirect filter and the store are the real ones.
import { type CanActivate, type ExecutionContext, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeClock } from '../../test/fakes/fake-clock.js';
import { testConfigService } from '../../test/support/test-env.js';
import { Clock } from '../common/clock/clock.js';
import { DomainError } from '../common/errors/domain-error.js';
import { ConsentsService } from '../privacy/consents.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GoogleCallbackRedirectFilter } from './google/google-callback-redirect.filter.js';
import { GOOGLE_FLOW_COOKIE, GoogleOAuthStateStore } from './google/google-oauth-state.store.js';
import { GoogleAuthGuard } from './guards/google-auth.guard.js';

const IDENTITY = { googleId: 'g-1', email: 'ana@example.test', emailVerified: true, name: 'Ana' };
const VERIFIER = 'pkce-verifier';

describe('GET /auth/google/callback, by the intent sealed at the start', () => {
  let app: INestApplication;
  let store: GoogleOAuthStateStore;
  const authService = {
    beginGoogleSignIn: vi.fn(),
    beginGoogleReauthentication: vi.fn(),
  };

  beforeEach(async () => {
    authService.beginGoogleSignIn.mockReset().mockResolvedValue('signin-code');
    authService.beginGoogleReauthentication.mockReset().mockResolvedValue('reauth-code');
    // the real guard's job on the callback: the store checks the state, then the identity is known
    const guard: CanActivate = {
      canActivate(context: ExecutionContext) {
        const req = context.switchToHttp().getRequest<Request & { user?: unknown }>();
        if (req.query.error) {
          throw Object.assign(new Error('access_denied'), { name: 'AuthorizationError' });
        }
        return new Promise<boolean>((resolve, reject) => {
          store.verify(req, req.query.state, (error) => {
            if (error) reject(error);
            else {
              req.user = IDENTITY;
              resolve(true);
            }
          });
        });
      },
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        GoogleOAuthStateStore,
        GoogleCallbackRedirectFilter,
        { provide: Clock, useValue: new FakeClock() },
        {
          provide: ConfigService,
          useValue: testConfigService({ FRONTEND_URL: 'https://app.example.test' }),
        },
        { provide: AuthService, useValue: authService },
        { provide: ConsentsService, useValue: {} },
      ],
    })
      .overrideGuard(GoogleAuthGuard)
      .useValue(guard)
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = moduleRef.createNestApplication();
    await app.init();
    store = moduleRef.get(GoogleOAuthStateStore);
  });

  afterEach(async () => {
    await app.close();
  });

  /** What a browser holds after starting the flow with this query: the cookie value and the state. */
  function started(query: Record<string, unknown> = {}) {
    let state = '';
    let value = '';
    const req = {
      headers: {},
      query,
      res: { cookie: (_name: string, v: string) => (value = v), clearCookie: () => undefined },
    } as unknown as Request;
    store.store(req, VERIFIER, undefined, {}, (error, s) => {
      if (error) throw error;
      state = s ?? '';
    });
    return { state, cookie: `${GOOGLE_FLOW_COOKIE}=${value}` };
  }

  const callback = (state: string, cookie: string | undefined, extra = '') =>
    request(app.getHttpServer())
      .get(`/auth/google/callback?state=${encodeURIComponent(state)}${extra}`)
      .set('Cookie', cookie ?? '');

  it('a re-authentication cookie redirects to the privacy page with the code, and starts no sign-in', async () => {
    const flow = started({ intent: 'reauth' });

    const response = await callback(flow.state, flow.cookie).expect(302);

    expect(response.headers.location).toBe(
      'https://app.example.test/profile/privacidade?reauth=reauth-code',
    );
    expect(authService.beginGoogleReauthentication).toHaveBeenCalledWith(IDENTITY);
    expect(authService.beginGoogleSignIn).not.toHaveBeenCalled();
  });

  it('an ordinary sign-in cookie redirects to /auth/callback and never to the privacy page', async () => {
    const flow = started();

    const response = await callback(flow.state, flow.cookie).expect(302);

    expect(response.headers.location).toBe(
      'https://app.example.test/auth/callback?code=signin-code',
    );
    expect(authService.beginGoogleReauthentication).not.toHaveBeenCalled();
  });

  it('?intent=reauth on the CALLBACK URL cannot turn a sign-in cookie into a re-authentication', async () => {
    const flow = started();

    const response = await callback(flow.state, flow.cookie, '&intent=reauth').expect(302);

    expect(response.headers.location).toContain('/auth/callback?code=signin-code');
    expect(authService.beginGoogleReauthentication).not.toHaveBeenCalled();
  });

  it('a re-authentication Google refuses to identify goes back to the privacy page with the reason', async () => {
    authService.beginGoogleReauthentication.mockRejectedValue(
      new DomainError('GOOGLE_SIGN_IN_FAILED'),
    );
    const flow = started({ intent: 'reauth' });

    const response = await callback(flow.state, flow.cookie).expect(302);

    expect(response.headers.location).toBe(
      'https://app.example.test/profile/privacidade?reauthError=GOOGLE_SIGN_IN_FAILED',
    );
  });

  it('Google answering error=access_denied to a re-authentication goes back to the privacy page, told by the cookie', async () => {
    const flow = started({ intent: 'reauth' });

    const response = await callback(flow.state, flow.cookie, '&error=access_denied').expect(302);

    expect(response.headers.location).toBe(
      'https://app.example.test/profile/privacidade?reauthError=GOOGLE_SIGN_IN_FAILED',
    );
  });

  it('access_denied for an ordinary sign-in, or with no cookie, still goes to the login', async () => {
    const flow = started();

    const ordinary = await callback(flow.state, flow.cookie, '&error=access_denied').expect(302);
    const none = await callback('x', undefined, '&error=access_denied').expect(302);

    for (const response of [ordinary, none]) {
      expect(response.headers.location).toBe(
        'https://app.example.test/login?error=GOOGLE_SIGN_IN_FAILED',
      );
    }
  });

  it('a state that does not match the cookie is refused to the login, even for a re-authentication cookie that was tampered with', async () => {
    const flow = started({ intent: 'reauth' });
    const tampered = `${flow.cookie.slice(0, -3)}AAA`;

    const response = await callback(flow.state, tampered).expect(302);

    expect(response.headers.location).toBe(
      'https://app.example.test/login?error=GOOGLE_SIGN_IN_FAILED',
    );
    expect(authService.beginGoogleReauthentication).not.toHaveBeenCalled();
  });
});
