// Issue #152, SC-02: the sealed Google sign-in state. Pure functions: the key and the time are
// arguments, so a plain Date stands in for the clock (AR-24).
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  GOOGLE_STATE_TTL_MS,
  deriveStateKey,
  openState,
  sameState,
  sealState,
} from './google-oauth-state.seal.js';

const NOW = new Date('2099-01-15T12:00:00.000Z');
const key = deriveStateKey('a-test-signing-secret');
const value = { state: 'state-value', verifier: 'verifier-value' };
const later = (ms: number) => new Date(NOW.getTime() + ms);

/** A value signed with `signingKey` over an arbitrary body: what only a key holder could make. */
const signed = (signingKey: Buffer, body: string) =>
  `${body}.${createHmac('sha256', signingKey).update(body).digest('base64url')}`;
const bodyOf = (payload: unknown) => Buffer.from(JSON.stringify(payload)).toString('base64url');

describe('deriveStateKey', () => {
  it('is deterministic and 32 bytes', () => {
    expect(deriveStateKey('s')).toEqual(deriveStateKey('s'));
    expect(deriveStateKey('s')).toHaveLength(32);
  });

  it('differs per secret, and from the secret itself', () => {
    expect(deriveStateKey('one')).not.toEqual(deriveStateKey('two'));
    expect(deriveStateKey('one')).not.toEqual(Buffer.from('one'));
  });
});

describe('sealState / openState', () => {
  it('opens what it sealed, until the ten minutes are over', () => {
    const sealed = sealState(key, value, NOW);

    expect(openState(key, sealed, NOW)).toEqual(value);
    expect(openState(key, sealed, later(GOOGLE_STATE_TTL_MS - 1))).toEqual(value);
  });

  it('refuses it from the moment it expires', () => {
    const sealed = sealState(key, value, NOW);

    expect(GOOGLE_STATE_TTL_MS).toBe(10 * 60 * 1000);
    expect(openState(key, sealed, later(GOOGLE_STATE_TTL_MS))).toBeNull();
    expect(openState(key, sealed, later(GOOGLE_STATE_TTL_MS + 1))).toBeNull();
  });

  it('refuses a value sealed with another key', () => {
    const sealed = sealState(deriveStateKey('another-secret'), value, NOW);

    expect(openState(key, sealed, NOW)).toBeNull();
  });

  it('refuses an altered body, even one that stays valid JSON', () => {
    const [, signature] = sealState(key, value, NOW).split('.');
    const forged = bodyOf({ ...value, state: 'attacker-state', expiresAt: NOW.getTime() + 1e9 });

    expect(openState(key, `${forged}.${signature}`, NOW)).toBeNull();
  });

  it('refuses an altered or truncated signature', () => {
    const [body, signature = ''] = sealState(key, value, NOW).split('.');
    const flipped = (signature[0] === 'A' ? 'B' : 'A') + signature.slice(1);

    expect(openState(key, `${body}.${flipped}`, NOW)).toBeNull();
    expect(openState(key, `${body}.${signature.slice(0, -4)}`, NOW)).toBeNull();
    expect(openState(key, `${body}.`, NOW)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['no dot', 'abc'],
    ['no body', '.abc'],
    ['three parts', 'a.b.c'],
    ['not base64url', '!!!.???'],
  ])('refuses a value that is not a sealed one: %s', (_label, junk) => {
    expect(openState(key, junk, NOW)).toBeNull();
  });

  it.each([
    ['not JSON', Buffer.from('not json').toString('base64url')],
    ['JSON null', bodyOf(null)],
    ['a JSON string', bodyOf('text')],
    ['no state', bodyOf({ verifier: 'v', expiresAt: NOW.getTime() + 1000 })],
    ['an empty state', bodyOf({ state: '', verifier: 'v', expiresAt: NOW.getTime() + 1000 })],
    ['no verifier', bodyOf({ state: 's', expiresAt: NOW.getTime() + 1000 })],
    ['an empty verifier', bodyOf({ state: 's', verifier: '', expiresAt: NOW.getTime() + 1000 })],
    ['a non-string state', bodyOf({ state: 1, verifier: 'v', expiresAt: NOW.getTime() + 1000 })],
    ['no expiry', bodyOf({ state: 's', verifier: 'v' })],
    ['a string expiry', bodyOf({ state: 's', verifier: 'v', expiresAt: '99999999999999' })],
  ])('refuses a correctly signed body that is %s', (_label, body) => {
    expect(openState(key, signed(key, body), NOW)).toBeNull();
  });
});

describe('the sealed intent (SPEC-010 BR-010-13)', () => {
  it('opens a re-authentication as `reauth`, and an ordinary flow with no intent at all', () => {
    expect(openState(key, sealState(key, { ...value, intent: 'reauth' }, NOW), NOW)).toEqual({
      ...value,
      intent: 'reauth',
    });
    expect(openState(key, sealState(key, value, NOW), NOW)).not.toHaveProperty('intent');
  });

  it('refuses an intent this server does not know, even correctly signed', () => {
    const body = bodyOf({ ...value, intent: 'admin', expiresAt: NOW.getTime() + 1000 });

    expect(openState(key, signed(key, body), NOW)).toBeNull();
  });

  it('refuses a body whose intent was added or changed after sealing (the signature breaks)', () => {
    const [body = '', signature] = sealState(key, value, NOW).split('.');
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString()) as object;
    const forged = bodyOf({ ...decoded, intent: 'reauth' });

    expect(openState(key, `${forged}.${signature}`, NOW)).toBeNull();
  });
});

describe('sameState', () => {
  it('compares by content', () => {
    expect(sameState('abc', 'abc')).toBe(true);
    expect(sameState('abc', 'abd')).toBe(false);
    expect(sameState('abc', 'abcd')).toBe(false);
    expect(sameState('abc', '')).toBe(false);
  });
});
