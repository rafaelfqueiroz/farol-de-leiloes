// AR-36: what the API says about an account, each field copied explicitly from the service's
// UserProfile: the password hash, tokens and Stripe ids never reach a response.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AuthenticatedUser, AuthResult, UserProfile } from '../interfaces/auth.interface';
import { SEX_VALUES } from './complete-profile.dto';

export const PROVIDERS = ['local', 'google'] as const;
export const ROLES = ['admin', 'free', 'standard', 'premium'] as const;

export class UserAddressDto {
  @ApiPropertyOptional({ type: String })
  street?: string;

  @ApiPropertyOptional({ type: String })
  city?: string;

  @ApiPropertyOptional({ type: String })
  state?: string;

  @ApiPropertyOptional({ type: String })
  zipCode?: string;

  constructor(address: NonNullable<UserProfile['address']>) {
    this.street = address.street;
    this.city = address.city;
    this.state = address.state;
    this.zipCode = address.zipCode;
  }
}

export class UserProfileResponseDto {
  @ApiProperty({ type: String })
  _id: string;

  @ApiProperty({ type: String, format: 'email' })
  email: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ enum: PROVIDERS, enumName: 'AuthProvider', isArray: true })
  providers: string[];

  @ApiProperty({ type: Boolean })
  emailVerified: boolean;

  @ApiProperty({ enum: ROLES, enumName: 'Role' })
  role: string;

  @ApiPropertyOptional({ type: String })
  phone?: string;

  @ApiPropertyOptional({ type: String })
  cpf?: string;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  dateOfBirth?: Date;

  @ApiPropertyOptional({ enum: SEX_VALUES, enumName: 'Sex' })
  sex?: string;

  @ApiPropertyOptional({ type: () => UserAddressDto })
  address?: UserAddressDto;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt: Date;

  constructor(profile: UserProfile) {
    this._id = profile._id;
    this.email = profile.email;
    this.name = profile.name;
    this.providers = profile.providers;
    this.emailVerified = profile.emailVerified;
    this.role = profile.role;
    this.phone = profile.phone;
    this.cpf = profile.cpf;
    this.dateOfBirth = profile.dateOfBirth;
    this.sex = profile.sex;
    this.address = profile.address ? new UserAddressDto(profile.address) : undefined;
    this.createdAt = profile.createdAt;
    this.updatedAt = profile.updatedAt;
  }
}

export class AuthResponseDto {
  @ApiProperty({ type: String, description: 'JWT for the Authorization: Bearer header' })
  accessToken: string;

  @ApiProperty({ type: () => UserProfileResponseDto })
  user: UserProfileResponseDto;

  constructor(result: AuthResult) {
    this.accessToken = result.accessToken;
    this.user = new UserProfileResponseDto(result.user);
  }
}

/** GET /auth/me: the signed-in user as the token and the account state describe them. */
export class CurrentUserResponseDto {
  @ApiProperty({ type: String })
  userId: string;

  @ApiProperty({ type: String, format: 'email' })
  email: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ type: Boolean })
  emailVerified: boolean;

  @ApiProperty({ enum: PROVIDERS, enumName: 'AuthProvider', isArray: true })
  providers: string[];

  @ApiProperty({ enum: ROLES, enumName: 'Role' })
  role: string;

  constructor(user: AuthenticatedUser) {
    this.userId = user.userId;
    this.email = user.email;
    this.name = user.name;
    this.emailVerified = user.emailVerified;
    this.providers = user.providers;
    this.role = user.role;
  }
}

export class VerificationStatusResponseDto {
  @ApiProperty({ type: Boolean })
  emailVerified: boolean;

  @ApiProperty({ enum: PROVIDERS, enumName: 'AuthProvider', isArray: true })
  providers: string[];

  constructor(status: { emailVerified: boolean; providers: string[] }) {
    this.emailVerified = status.emailVerified;
    this.providers = status.providers;
  }
}
