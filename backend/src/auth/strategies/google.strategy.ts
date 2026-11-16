import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy } from 'passport-google-oauth20';
import type { Env } from '../../config/env.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { toGoogleIdentity, type GoogleIdentity } from '../google/google-identity.js';

/**
 * The boundary with Google (TS-07): it turns the profile Google returned into a `GoogleIdentity`
 * and nothing else. It does not look up, link or create an account; those rules (BR-001-08 to
 * BR-001-11) live in AuthService, which the callback calls with this identity.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(configService: ConfigService<Env, true>) {
    // AR-42: typed config, validated at boot (AR-41).
    super({
      clientID: configService.get('GOOGLE_CLIENT_ID', { infer: true }),
      clientSecret: configService.get('GOOGLE_CLIENT_SECRET', { infer: true }),
      callbackURL: configService.get('GOOGLE_CALLBACK_URL', { infer: true }),
      scope: ['email', 'profile'],
    });
  }

  // @nestjs/passport hands the returned value to passport as the signed-in user, so it lands on
  // `request.user` as a GoogleIdentity; a thrown error reaches the callback's redirect filter.
  validate(_accessToken: string, _refreshToken: string, profile: Profile): GoogleIdentity {
    const identity = toGoogleIdentity(profile);
    // The 'email' scope is requested, so Google always sends one; refuse the sign-in if not.
    if (!identity) {
      throw new DomainError('GOOGLE_ACCOUNT_WITHOUT_EMAIL');
    }
    return identity;
  }
}
