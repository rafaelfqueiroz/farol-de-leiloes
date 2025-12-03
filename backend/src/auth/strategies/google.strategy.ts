import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { UsersService } from '../../users/users.service';

@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(private usersService: UsersService) {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
      callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }

  async validate(
    accessToken: string,
    refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<any> {
    const { id, emails, displayName } = profile;
    const email = emails[0].value;

    // Try to find user by Google ID
    let user = await this.usersService.findByGoogleId(id);

    // If not found, try to find by email
    if (!user) {
      user = await this.usersService.findByEmail(email);
    }

    // If still not found, create new user
    if (!user) {
      user = await this.usersService.create({
        email,
        name: displayName,
        googleId: id,
        provider: 'google',
      });
    }

    done(null, user);
  }
}
