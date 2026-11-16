// Issue #152, SC-02: OAuth `state` and PKCE on the Google sign-in, through the HTTP API with the
// REAL GoogleAuthGuard, GoogleStrategy and state store on a real MongoDB (TESTING §2, TS-02).
// Google is stubbed at the library boundary only (TS-07): the two calls the OAuth2 client would
// make to Google (the token endpoint and the userinfo endpoint) are replaced on the strategy's
// client, so nothing reaches the network; the start and the callback, the cookie, the state
// check, the service, the rules and the database are all real.
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';
import { AccountTokenEntity } from '../../src/auth/tokens/account-token.schema.js';
import { SessionEntity } from '../../src/auth/sessions/session.schema.js';
import { GoogleStrategy } from '../../src/auth/strategies/google.strategy.js';
import { UserEntity } from '../../src/users/schemas/user.schema.js';
import { MINUTE } from '../fakes/fake-clock.js';
import { AUTH_TEST_START, createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { spyOnLogger } from '../support/logger-spy.js';
import { useTestDatabase } from '../support/test-database.js';

const FRONTEND = 'http://localhost:3001';
const REFUSED = `${FRONTEND}/login?error=GOOGLE_SIGN_IN_FAILED`;
const COOKIE = 'google_oauth_state';
const GOOGLE_SUB = 'google-sub-state-spec';
const EMAIL = 'state-spec@example.test';

type OAuthClient = {
  getOAuthAccessToken: (code: string, params: Record<string, string>, cb: unknown) => void;
  get: (url: string, token: string, cb: (...args: unknown[]) => void) => void;
};

describe('Google sign-in state and PKCE (integration, issue #152)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let connection: Connection;
  let tokenRequests: Array<{ code: string; params: Record<string, string> }>;
  let models: Array<Model<never>>;

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];

  /** Everything a successful sign-in could create. */
  async function stored() {
    return Promise.all(models.map((model) => model.countDocuments({})));
  }

  /** The start: the redirect to Google, the cookie the browser keeps and the params Google gets. */
  async function startFlow() {
    const response = await request(server()).get('/api/auth/google').expect(302);
    const location = new URL(response.headers['location'] as string);
    const setCookie = (response.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
    const raw = setCookie.find((c) => c.startsWith(`${COOKIE}=`)) ?? '';
    return {
      location,
      params: location.searchParams,
      setCookie: raw,
      cookie: raw.split(';')[0] ?? '', // name=value, as a browser sends it back
      value: (raw.split(';')[0] ?? '').slice(COOKIE.length + 1),
      state: location.searchParams.get('state') ?? '',
    };
  }

  const callback = (query: string, cookie?: string) => {
    const call = request(server()).get(`/api/auth/google/callback${query}`);
    return cookie === undefined ? call : call.set('Cookie', cookie);
  };

  async function expectRefused(response: Promise<request.Response> | request.Response) {
    const result = await response;
    expect(result.status).toBe(302);
    expect(result.headers['location']).toBe(REFUSED);
    return result;
  }

  beforeAll(async () => {
    harness = await createAuthTestApp(db);
    connection = harness.moduleRef.get(getConnectionToken());
    models = [UserEntity, AccountTokenEntity, SessionEntity].map((entity) =>
      harness.moduleRef.get(getModelToken(entity.name)),
    );
    await connection.syncIndexes();
  });

  afterAll(async () => {
    await harness.app.close();
  });

  beforeEach(() => {
    harness.clock.set(AUTH_TEST_START);
    tokenRequests = [];
    // Google's side, replaced where the library would call it.
    const oauth2 = (harness.moduleRef.get(GoogleStrategy) as unknown as { _oauth2: OAuthClient })
      ._oauth2;
    vi.spyOn(oauth2, 'getOAuthAccessToken').mockImplementation(((
      code: string,
      params: Record<string, string>,
      cb: (...args: unknown[]) => void,
    ) => {
      tokenRequests.push({ code, params });
      cb(null, 'google-access-token', 'google-refresh-token', {});
    }) as never);
    vi.spyOn(oauth2, 'get').mockImplementation(((
      _url: string,
      _token: string,
      cb: (...args: unknown[]) => void,
    ) => {
      cb(
        null,
        JSON.stringify({ sub: GOOGLE_SUB, name: 'Ana State', email: EMAIL, email_verified: true }),
        {},
      );
    }) as never);
  });

  afterEach(() => vi.restoreAllMocks());

  describe('the start of the flow', () => {
    it('sends Google state and a PKCE S256 challenge, and sets the signed state cookie', async () => {
      const started = await startFlow();

      expect(started.location.origin + started.location.pathname).toBe(
        'https://accounts.google.com/o/oauth2/v2/auth',
      );
      expect(started.params.get('response_type')).toBe('code');
      expect(started.params.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(started.params.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(started.params.get('code_challenge_method')).toBe('S256');

      const attributes = started.setCookie.split(';').map((part) => part.trim().toLowerCase());
      expect(attributes).toContain('path=/api/auth/google/callback');
      expect(attributes).toContain('httponly');
      expect(attributes).toContain('samesite=lax');
      expect(attributes).toContain('max-age=600');
      expect(attributes).not.toContain('secure'); // NODE_ENV is test; production sets it
      expect(started.value).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    });

    it('uses a new state, challenge and cookie on every start', async () => {
      const first = await startFlow();
      const second = await startFlow();

      expect(second.state).not.toBe(first.state);
      expect(second.params.get('code_challenge')).not.toBe(first.params.get('code_challenge'));
      expect(second.value).not.toBe(first.value);
    });
  });

  describe('the return from Google', () => {
    it('AC: a callback with the state of the start reaches the exchange-code redirect, and spends the cookie', async () => {
      const started = await startFlow();

      const response = await callback(`?code=google-code&state=${started.state}`, started.cookie);

      expect(response.status).toBe(302);
      const location = new URL(response.headers['location'] as string);
      expect(location.origin + location.pathname).toBe(`${FRONTEND}/auth/callback`);
      expect(location.searchParams.get('code')).toBeTruthy();
      // A first sign-in: nothing but the signup record exists until the terms are accepted.
      expect(await models[0]?.countDocuments({})).toBe(0);
      const cleared = ((response.headers['set-cookie'] as unknown as string[]) ?? []).find((c) =>
        c.startsWith(`${COOKIE}=;`),
      );
      expect(cleared).toMatch(/Path=\/api\/auth\/google\/callback/);
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it('PKCE: the code verifier Google receives is the one stored at the start, and matches the challenge', async () => {
      const started = await startFlow();
      const [body = ''] = started.value.split('.');
      const { verifier } = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
        verifier: string;
      };

      await callback(`?code=google-code&state=${started.state}`, started.cookie).expect(302);

      expect(tokenRequests).toHaveLength(1);
      expect(tokenRequests[0]?.code).toBe('google-code');
      expect(tokenRequests[0]?.params['code_verifier']).toBe(verifier);
      expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
        started.params.get('code_challenge'),
      );
    });

    describe('is refused with /login?error=GOOGLE_SIGN_IN_FAILED, before Google is asked for anything and with nothing created', () => {
      async function expectNothingHappened(
        run: () => Promise<request.Response> | request.Response,
      ) {
        const before = await stored();
        await expectRefused(run());
        expect(tokenRequests).toEqual([]);
        expect(await stored()).toEqual(before);
      }

      it('without a state', async () => {
        const started = await startFlow();

        await expectNothingHappened(() => callback('?code=google-code', started.cookie));
      });

      it('with a state that is not the cookie state (the attacker flow of a login CSRF)', async () => {
        const victim = await startFlow();
        const attacker = await startFlow();

        await expectNothingHappened(() =>
          callback(`?code=attackers-code&state=${attacker.state}`, victim.cookie),
        );
      });

      it('without the cookie (the victim never started a flow)', async () => {
        const attacker = await startFlow();

        await expectNothingHappened(() => callback(`?code=attackers-code&state=${attacker.state}`));
      });

      it('with a tampered cookie signature', async () => {
        const started = await startFlow();
        const [body = '', signature = ''] = started.value.split('.');
        const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);

        await expectNothingHappened(() =>
          callback(`?code=google-code&state=${started.state}`, `${COOKIE}=${body}.${flipped}`),
        );
      });

      it('with a cookie body rewritten to the attacker state and the old signature', async () => {
        const started = await startFlow();
        const [body = '', signature = ''] = started.value.split('.');
        const forged = Buffer.from(
          JSON.stringify({
            ...(JSON.parse(Buffer.from(body, 'base64url').toString()) as object),
            state: 'attacker-state',
          }),
        ).toString('base64url');

        await expectNothingHappened(() =>
          callback('?code=google-code&state=attacker-state', `${COOKIE}=${forged}.${signature}`),
        );
      });

      it('with an expired cookie (ten minutes after the start)', async () => {
        const started = await startFlow();
        harness.clock.advance(10 * MINUTE);

        await expectNothingHappened(() =>
          callback(`?code=google-code&state=${started.state}`, started.cookie),
        );
      });

      it('on a second callback re-using the same state after the cookie was cleared', async () => {
        const agent = request.agent(server());
        const start = await agent.get('/api/auth/google').expect(302);
        const state = new URL(start.headers['location'] as string).searchParams.get('state');
        await agent.get(`/api/auth/google/callback?code=google-code&state=${state}`).expect(302);
        expect(tokenRequests).toHaveLength(1);
        const before = await stored();

        const replay = await agent.get(`/api/auth/google/callback?code=google-code&state=${state}`);

        expect(replay.status).toBe(302);
        expect(replay.headers['location']).toBe(REFUSED);
        expect(tokenRequests).toHaveLength(1); // Google was not asked again
        expect(await stored()).toEqual(before);
      });

      it('and the refusal clears the cookie too', async () => {
        const started = await startFlow();

        const response = await expectRefused(callback('?code=google-code', started.cookie));

        const cleared = ((response.headers['set-cookie'] as unknown as string[]) ?? []).find((c) =>
          c.startsWith(`${COOKIE}=;`),
        );
        expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
      });
    });

    it('the refusal reflects nothing: no state, no library message, in the redirect', async () => {
      const started = await startFlow();

      const response = await expectRefused(
        callback('?code=google-code&state=foreign-state', started.cookie),
      );

      const location = response.headers['location'] as string;
      expect(location).not.toContain('foreign-state');
      expect(location).not.toContain(started.state);
      expect(response.text).not.toContain('foreign-state');
    });
  });

  it('SC-15: neither the state, the verifier nor the cookie is logged, on success or refusal', async () => {
    const log = spyOnLogger();
    const started = await startFlow();
    const [body = ''] = started.value.split('.');
    const { verifier } = JSON.parse(Buffer.from(body, 'base64url').toString()) as {
      verifier: string;
    };

    await callback('?code=google-code&state=foreign-state', started.cookie).expect(302);
    await callback(`?code=google-code&state=${started.state}`, started.cookie).expect(302);

    const logged = log.loggedText();
    for (const secret of [started.state, verifier, started.value, 'foreign-state']) {
      expect(logged).not.toContain(secret);
    }
  });
});
