import { describe, expect, it } from 'vitest';
import type { Profile } from 'passport-google-oauth20';
import { GoogleStrategy } from './google.strategy.js';
import { DomainError } from '../../common/errors/domain-error.js';

describe('GoogleStrategy.validate', () => {
  // Built without the passport constructor, which needs real OAuth client options.
  const strategy: GoogleStrategy = Object.create(GoogleStrategy.prototype) as GoogleStrategy;

  it.each([
    ['no emails', undefined],
    ['an empty email list', []],
  ])('refuses a Google profile with %s (DV-03)', (_label, emails) => {
    const profile = { id: 'google-1', displayName: 'Test User', emails } as unknown as Profile;

    expect(() => strategy.validate('access', 'refresh', profile)).toThrow(
      new DomainError('GOOGLE_ACCOUNT_WITHOUT_EMAIL'),
    );
  });

  it('BR-001-08: hands on the verified claim as Google reported it, and only the identity', () => {
    const profile = {
      id: 'google-1',
      displayName: 'Ana Teste',
      emails: [{ value: 'ana@example.test', verified: true }],
      _json: { email_verified: true },
      photos: [{ value: 'https://example.test/p.png' }],
    } as unknown as Profile;

    expect(strategy.validate('access', 'refresh', profile)).toEqual({
      googleId: 'google-1',
      email: 'ana@example.test',
      emailVerified: true,
      name: 'Ana Teste',
    });
  });
});
