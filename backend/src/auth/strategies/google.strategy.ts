import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Profile, Strategy, VerifyCallback } from 'passport-google-oauth20';
import { UsersService } from '../../users/users.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private usersService: UsersService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackURL:
        process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback',
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
      throw new UnauthorizedException('Google account has no email address');
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
