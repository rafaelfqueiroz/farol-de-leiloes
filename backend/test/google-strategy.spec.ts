import { UnauthorizedException } from '@nestjs/common';
import { Profile } from 'passport-google-oauth20';
import { GoogleStrategy } from '../src/auth/strategies/google.strategy';

describe('GoogleStrategy.validate', () => {
  function build() {
    const usersService = {
      findByGoogleId: jest.fn(),
      findByEmail: jest.fn(),
      linkGoogleAccount: jest.fn(),
      create: jest.fn(),
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
    const done = jest.fn();

    await expect(strategy.validate('access', 'refresh', profile, done)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(usersService.findByGoogleId).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });
});
