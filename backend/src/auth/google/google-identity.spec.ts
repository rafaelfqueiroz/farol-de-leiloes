// BR-001-08, BR-001-11: reading Google's profile strictly. The library exposes the verified claim
// as `_json.email_verified` and as `emails[0].verified`; only a clear "true" counts.
import { describe, expect, it } from 'vitest';
import type { Profile } from 'passport-google-oauth20';
import {
  googleReportsEmailVerified,
  isVerifiedClaim,
  toGoogleIdentity,
} from './google-identity.js';

function profile(parts: Record<string, unknown>): Profile {
  return { id: 'g-1', displayName: 'Ana Teste', ...parts } as unknown as Profile;
}

describe('isVerifiedClaim', () => {
  it.each([true, 'true'])('accepts %j', (value) => {
    expect(isVerifiedClaim(value)).toBe(true);
  });

  it.each([false, 'false', 'True', 'TRUE', 'yes', '1', 1, 0, null, undefined, {}, [], [true]])(
    'BR-001-08: treats %j as unverified',
    (value) => {
      expect(isVerifiedClaim(value)).toBe(false);
    },
  );
});

describe('googleReportsEmailVerified', () => {
  const email = (verified?: unknown) => [{ value: 'ana@example.test', verified }];

  it.each([
    ['_json true', { _json: { email_verified: true } }, true],
    ['_json "true"', { _json: { email_verified: 'true' } }, true],
    ['emails[0].verified true', { emails: email(true) }, true],
    ['both true', { _json: { email_verified: true }, emails: email(true) }, true],
    ['_json false', { _json: { email_verified: false } }, false],
    ['emails[0].verified false', { emails: email(false) }, false],
    ['reported nowhere', { emails: email(undefined), _json: {} }, false],
    ['no _json and no emails', {}, false],
    ['_json null', { _json: { email_verified: null } }, false],
    [
      '_json says true, emails says false',
      { _json: { email_verified: true }, emails: email(false) },
      false,
    ],
    [
      '_json says false, emails says true',
      { _json: { email_verified: false }, emails: email(true) },
      false,
    ],
    ['_json true, emails silent', { _json: { email_verified: true }, emails: email() }, true],
  ])('BR-001-08: %s', (_label, parts, expected) => {
    expect(googleReportsEmailVerified(profile(parts))).toBe(expected);
  });
});

describe('toGoogleIdentity', () => {
  const verified = { emails: [{ value: 'Ana@Example.test', verified: true }] };

  it('BR-001-11: keeps Google permanent id, the email as sent and the display name', () => {
    expect(toGoogleIdentity(profile(verified))).toEqual({
      googleId: 'g-1',
      email: 'Ana@Example.test',
      emailVerified: true,
      name: 'Ana Teste',
    });
  });

  it('falls back to the part of the email before the @ when Google sends no name', () => {
    expect(toGoogleIdentity(profile({ ...verified, displayName: '  ' }))?.name).toBe('Ana');
    expect(toGoogleIdentity(profile({ ...verified, displayName: undefined }))?.name).toBe('Ana');
  });

  it('keeps a name within 120 characters', () => {
    const name = toGoogleIdentity(profile({ ...verified, displayName: 'x'.repeat(300) }))?.name;
    expect(name).toHaveLength(120);
  });

  it.each([
    ['no id', { id: '' }],
    ['a non-string id', { id: 12345 }],
    ['an id over 255 characters', { id: 'x'.repeat(256) }],
    ['no email list', { emails: undefined }],
    ['an empty email', { emails: [{ value: '  ', verified: true }] }],
    ['a non-string email', { emails: [{ value: { $ne: null }, verified: true }] }],
  ])('refuses a profile with %s', (_label, parts) => {
    expect(toGoogleIdentity(profile({ ...verified, ...parts }))).toBeNull();
  });
});
