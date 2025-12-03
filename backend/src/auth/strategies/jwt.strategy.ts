import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private usersService: UsersService,
    configService: ConfigService,
  ) {
    const jwtSecret = configService.get<string>('JWT_SECRET') || 'your-secret-key';
    const logger = new Logger('JwtStrategy-Constructor');
    logger.log(`JWT_SECRET loaded: ${jwtSecret.substring(0, 10)}... (length: ${jwtSecret.length})`);

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtSecret,
    });
  }

  async validate(payload: any) {
    this.logger.log(`JWT validation - payload: ${JSON.stringify(payload)}`);
    const user = await this.usersService.findById(payload.sub);
    this.logger.log(`JWT validation - user found: ${user ? 'yes' : 'no'}`);
    if (!user) {
      this.logger.warn(`JWT validation - User not found for ID: ${payload.sub}`);
      throw new UnauthorizedException('User not found');
    }
    return { userId: payload.sub, email: payload.email, name: payload.name };
  }
}
