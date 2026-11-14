import { describe, expect, it, vi } from 'vitest';
import { Profile } from 'passport-google-oauth20';
import { GoogleStrategy } from './google.strategy.js';
import { DomainError } from '../../common/errors/domain-error.js';

describe('GoogleStrategy.validate', () => {
  function build() {
    const usersService = {
      findByGoogleId: vi.fn(),
      findByEmail: vi.fn(),
      linkGoogleAccount: vi.fn(),
      create: vi.fn(),
    };
    // Built without the passport constructor, which needs real OAuth client options.
    const strategy: GoogleStrategy = Object.assign(Object.create(GoogleStrategy.prototype), {
      usersService,
    });
    return { strategy, usersService };
  }

  it.each([
    ['no emails', undefined],
    ['an empty email list', []],
  ])('refuses a Google profile with %s (DV-03)', async (_label, emails) => {
    const { strategy, usersService } = build();
    const profile = { id: 'google-1', displayName: 'Test User', emails } as unknown as Profile;
    const done = vi.fn();

    await expect(strategy.validate('access', 'refresh', profile, done)).rejects.toEqual(
      new DomainError('GOOGLE_ACCOUNT_WITHOUT_EMAIL'),
    );
    expect(usersService.findByGoogleId).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });
});
