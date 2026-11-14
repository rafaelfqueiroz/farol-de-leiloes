import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { UsersService } from '../../users/users.service.js';
import type { Env } from '../../config/env.js';
import { DomainError } from '../../common/errors/domain-error.js';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    private usersService: UsersService,
    configService: ConfigService<Env, true>,
  ) {
    // AR-42: typed config, validated at boot (AR-41).
    super({
      clientID: configService.get('GOOGLE_CLIENT_ID', { infer: true }),
      clientSecret: configService.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      callbackURL: configService.get('GOOGLE_CALLBACK_URL', { infer: true }),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: Profile,
    done: VerifyCallback,
  ): Promise<void> {
    const { id, emails, displayName } = profile;
    const email = emails?.[0]?.value;
    // The 'email' scope is requested, so Google always sends one; refuse the sign-in if not.
    if (!email) {
      throw new DomainError('GOOGLE_ACCOUNT_WITHOUT_EMAIL');
    }

    // Try to find user by Google ID (already linked)
    let user = await this.usersService.findByGoogleId(id);

    if (!user) {
      // Try to find by email (existing local account)
      user = await this.usersService.findByEmail(email);

      if (user) {
        // Link Google identity to existing account
        user = await this.usersService.linkGoogleAccount(user._id.toString(), id);
      } else {
        // Create brand new Google user
        user = await this.usersService.create({
          email,
          name: displayName,
          googleId: id,
          providers: ['google'],
        });
      }
    }

    done(null, user);
  }
}
