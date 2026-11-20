// AR-36: what the API says about an account, each field copied explicitly from the service's
// UserProfile: the password hash, tokens and Stripe ids never reach a response.
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AuthenticatedUser,
  AuthResult,
  GoogleExchangeResult,
  UserProfile,
} from '../interfaces/auth.interface.js';
import { SUBSCRIPTION_STATUSES } from '../../users/subscription-status.js';
import type { AccessContext } from '../../access/access-context.js';
import { type Persona, PERSONAS } from '../../access/domain/personas.js';
import type { LegalDocumentRef } from '../../privacy/domain/legal-versions.js';
import { LegalDocumentRefDto } from '../../privacy/dto/legal-document-ref.dto.js';

export const PROVIDERS = ['local', 'google'] as const;
export const ROLES = ['admin', 'free', 'standard', 'premium'] as const;

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

  @ApiProperty({ enum: SUBSCRIPTION_STATUSES, enumName: 'SubscriptionStatus', nullable: true })
  subscriptionStatus: string | null;

  @ApiProperty({
    type: Boolean,
    description: 'Platform-operation capability (SPEC-002 DL-002-05); no client data, no plan',
  })
  isAdmin: boolean;

  @ApiPropertyOptional({ type: String })
  phone?: string;

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
    this.subscriptionStatus = profile.subscriptionStatus;
    this.isAdmin = profile.isAdmin;
    this.phone = profile.phone;
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

export const GOOGLE_EXCHANGE_STATUSES = ['signed_in', 'terms_required'] as const;

/**
 * POST /auth/google/exchange. The two answers differ only by `status`: `signed_in` carries the
 * session like a login does; `terms_required` carries what Google said, so the terms screen can
 * greet the person, and no session (BR-001-09).
 */
export class GoogleExchangeResponseDto {
  @ApiProperty({ enum: GOOGLE_EXCHANGE_STATUSES, enumName: 'GoogleExchangeStatus' })
  status: (typeof GOOGLE_EXCHANGE_STATUSES)[number];

  @ApiPropertyOptional({ type: String, description: 'status signed_in: JWT for Bearer' })
  accessToken?: string;

  @ApiPropertyOptional({ type: () => UserProfileResponseDto, description: 'status signed_in' })
  user?: UserProfileResponseDto;

  @ApiPropertyOptional({ type: String, format: 'email', description: 'status terms_required' })
  email?: string;

  @ApiPropertyOptional({ type: String, description: 'status terms_required' })
  name?: string;

  constructor(result: GoogleExchangeResult) {
    this.status = result.status;
    if (result.status === 'signed_in') {
      this.accessToken = result.accessToken;
      this.user = new UserProfileResponseDto(result.user);
    } else {
      this.email = result.email;
      this.name = result.name;
    }
  }
}

/**
 * GET /auth/me: the signed-in user as the token and the account state describe them, plus the
 * capabilities the interface may show (SPEC-002). They are UI hints only: the server checks every
 * request on its own (BR-002-10, AR-51).
 */
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

  @ApiProperty({
    enum: ROLES,
    enumName: 'Role',
    description:
      "The plan tier until SPEC-012. 'admin' is a legacy value that is no plan (BR-002-23); " +
      'the admin capability is isAdmin',
  })
  role: string;

  @ApiProperty({ enum: SUBSCRIPTION_STATUSES, enumName: 'SubscriptionStatus', nullable: true })
  subscriptionStatus: string | null;

  @ApiProperty({
    type: Boolean,
    description: 'Platform-operation capability (SPEC-002 DL-002-05); no client data, no plan',
  })
  isAdmin: boolean;

  @ApiProperty({
    enum: PERSONAS,
    enumName: 'Persona',
    isArray: true,
    description: 'Derived from current relationships on this request (SPEC-002 BR-002-14)',
  })
  personas: Persona[];

  @ApiProperty({
    type: Boolean,
    description:
      'True when the account has not accepted the current terms of use and privacy policy ' +
      '(SPEC-010 BR-010-05): the interface asks for the acceptance. Reported whether or not the ' +
      'server already refuses the account features (TERMS_ENFORCEMENT_ENABLED).',
  })
  termsAcceptanceRequired: boolean;

  @ApiProperty({
    type: () => [LegalDocumentRefDto],
    description: 'The documents still to accept; empty when termsAcceptanceRequired is false',
  })
  documents: LegalDocumentRefDto[];

  @ApiProperty({
    type: Boolean,
    description:
      'True until the account answers the one-time WhatsApp consent request, whichever the ' +
      'answer (SPEC-010 BR-010-27)',
  })
  whatsappPromptPending: boolean;

  constructor(
    user: AuthenticatedUser,
    access: AccessContext,
    pendingDocuments: readonly LegalDocumentRef[] = [],
  ) {
    this.userId = user.userId;
    this.email = user.email;
    this.name = user.name;
    this.emailVerified = user.emailVerified;
    this.providers = user.providers;
    this.role = user.role;
    this.subscriptionStatus = user.subscriptionStatus;
    this.isAdmin = access.isAdmin;
    this.personas = [...access.personas];
    this.termsAcceptanceRequired = pendingDocuments.length > 0;
    this.documents = pendingDocuments.map((document) => new LegalDocumentRefDto(document));
    this.whatsappPromptPending = user.whatsappPromptPending;
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
