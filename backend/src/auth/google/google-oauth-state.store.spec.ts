// Issue #152, SC-02: the passport state store of the Google flow, driven the way passport-oauth2
// drives it, with a fake request/response and the FakeClock (AR-24). No network, no database.
import { describe, expect, it, vi } from 'vitest';
import type { Request } from 'express';
import { DomainError } from '../../common/errors/domain-error.js';
import { FakeClock, MINUTE } from '../../../test/fakes/fake-clock.js';
import { spyOnLogger } from '../../../test/support/logger-spy.js';
import { testConfigService } from '../../../test/support/test-env.js';
import {
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_COOKIE_PATH,
  GoogleOAuthStateStore,
} from './google-oauth-state.store.js';

const START = new Date('2099-01-15T12:00:00.000Z');
const VERIFIER = 'pkce-code-verifier-from-the-library';

function setup(env: Record<string, string> = {}) {
  const clock = new FakeClock(START);
  const store = new GoogleOAuthStateStore(testConfigService(env), clock);
  return { clock, store };
}

/** A response that records the cookie calls, and a request that carries it. */
function exchange(cookieHeader?: string) {
  const cookie = vi.fn();
  const clearCookie = vi.fn();
  const req = {
    headers: cookieHeader === undefined ? {} : { cookie: cookieHeader },
    res: { cookie, clearCookie },
  } as unknown as Request;
  return { req, cookie, clearCookie };
}

/** Starts the flow and returns what the browser would hold and what Google would be sent. */
function start(store: GoogleOAuthStateStore) {
  const { req, cookie } = exchange();
  let state = '';
  store.store(req, VERIFIER, undefined, {}, (error, stored) => {
    expect(error).toBeNull();
    state = stored ?? '';
  });
  const [name, value, options] = cookie.mock.calls[0] as [string, string, Record<string, unknown>];
  return { name, value, options, state };
}

function verify(store: GoogleOAuthStateStore, cookieHeader: string | undefined, state: unknown) {
  const { req, clearCookie } = exchange(cookieHeader);
  const results: unknown[][] = [];
  store.verify(req, state, (...args: unknown[]) => results.push(args));
  return { results, clearCookie };
}

describe('GoogleOAuthStateStore as passport-oauth2 calls it', () => {
  it('declares the parameter counts the library switches on (5 for store with PKCE, 3 for verify)', () => {
    const { store } = setup();

    expect(store.store.length).toBe(5);
    expect(store.verify.length).toBe(3);
  });
});

describe('store (the start of the flow)', () => {
  it('sends Google a random 32-byte base64url state and sets the sealed cookie', () => {
    const { store } = setup();

    const { name, value, options, state } = start(store);

    expect(name).toBe(GOOGLE_STATE_COOKIE);
    expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(value).not.toContain(VERIFIER); // base64 inside the sealed body, never as sent
    expect(Buffer.from(value.split('.')[0] ?? '', 'base64url').toString()).toContain(VERIFIER);
    expect(options).toEqual({
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // NODE_ENV is test
      path: GOOGLE_STATE_COOKIE_PATH,
      maxAge: 10 * 60 * 1000,
    });
  });

  it('marks the cookie Secure in production only', () => {
    const production = setup({ NODE_ENV: 'production' });

    expect(start(production.store).options.secure).toBe(true);
  });

  it('mints a different state, and a different cookie, every time', () => {
    const { store } = setup();

    const first = start(store);
    const second = start(store);

    expect(first.state).not.toBe(second.state);
    expect(first.value).not.toBe(second.value);
  });

  it.each([
    ['no verifier (PKCE off)', undefined, true],
    ['no response to set the cookie on', VERIFIER, false],
  ])('fails when there is %s', (_label, verifier, withResponse) => {
    const { store } = setup();
    const req = { headers: {}, res: withResponse ? { cookie: vi.fn() } : undefined } as never;
    const callback = vi.fn();

    store.store(req, verifier, undefined, {}, callback);

    expect(callback).toHaveBeenCalledWith(expect.any(Error));
    expect(callback.mock.calls[0]?.[1]).toBeUndefined();
  });
});

describe('verify (the return from Google)', () => {
  it('hands passport the verifier of the start when the state is the cookie state, and clears the cookie', () => {
    const { store } = setup();
    const started = start(store);

    const { results, clearCookie } = verify(
      store,
      `other=1; ${GOOGLE_STATE_COOKIE}=${started.value}`,
      started.state,
    );

    expect(results).toEqual([[null, VERIFIER]]);
    expect(clearCookie).toHaveBeenCalledWith(
      GOOGLE_STATE_COOKIE,
      expect.objectContaining({ path: GOOGLE_STATE_COOKIE_PATH, httpOnly: true, sameSite: 'lax' }),
    );
  });

  const refused = (results: unknown[][]) => {
    expect(results).toHaveLength(1);
    const [error, verifier] = results[0] ?? [];
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('GOOGLE_SIGN_IN_FAILED');
    expect(verifier).toBeUndefined();
  };

  it('refuses a callback with no cookie, and still clears it', () => {
    const { store } = setup();
    const { state } = start(store);

    const { results, clearCookie } = verify(store, undefined, state);

    refused(results);
    expect(clearCookie).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a missing state', undefined],
    ['an empty state', ''],
    ['a state sent twice (an array)', ['a', 'b']],
    ['a foreign state', 'someone-elses-state-value'],
  ])('refuses %s', (_label, provided) => {
    const { store } = setup();
    const started = start(store);

    const { results } = verify(store, `${GOOGLE_STATE_COOKIE}=${started.value}`, provided);

    refused(results);
  });

  it('refuses a state that is only a prefix of the cookie state', () => {
    const { store } = setup();
    const started = start(store);

    const { results } = verify(
      store,
      `${GOOGLE_STATE_COOKIE}=${started.value}`,
      started.state.slice(0, 20),
    );

    refused(results);
  });

  it('refuses a cookie whose signature was altered, with the right state', () => {
    const { store } = setup();
    const started = start(store);
    const [body = '', signature = ''] = started.value.split('.');
    const tampered = `${body}.${(signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)}`;

    const { results } = verify(store, `${GOOGLE_STATE_COOKIE}=${tampered}`, started.state);

    refused(results);
  });

  it('refuses a cookie whose body was swapped for the attacker state, keeping the signature', () => {
    const { store } = setup();
    const started = start(store);
    const [body = '', signature = ''] = started.value.split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString()) as object;
    const forged = Buffer.from(JSON.stringify({ ...decoded, state: 'attacker-state' })).toString(
      'base64url',
    );

    const { results } = verify(
      store,
      `${GOOGLE_STATE_COOKIE}=${forged}.${signature}`,
      'attacker-state',
    );

    refused(results);
  });

  it('refuses a cookie sealed by a server with another JWT_SECRET', () => {
    const other = setup({ JWT_SECRET: 'another-jwt-secret-entirely' }).store;
    const foreign = start(other);
    const { store } = setup();

    const { results } = verify(store, `${GOOGLE_STATE_COOKIE}=${foreign.value}`, foreign.state);

    refused(results);
  });

  it('accepts the return within ten minutes and refuses it after (FakeClock)', () => {
    const { store, clock } = setup();
    const started = start(store);
    const header = `${GOOGLE_STATE_COOKIE}=${started.value}`;

    clock.advance(10 * MINUTE - 1);
    expect(verify(store, header, started.state).results).toEqual([[null, VERIFIER]]);

    clock.advance(1);
    refused(verify(store, header, started.state).results);
  });

  it('SC-15: nothing about the state, the verifier or the cookie is logged', () => {
    const log = spyOnLogger();
    const { store } = setup();
    const started = start(store);

    verify(store, `${GOOGLE_STATE_COOKIE}=${started.value}`, 'foreign');
    verify(store, undefined, started.state);

    // Nothing is logged at all: the refusal carries only its closed code.
    expect(log.loggedText()).toBe('');
  });
});
