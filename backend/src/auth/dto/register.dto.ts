import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Equals, IsNotEmpty, IsString } from 'class-validator';
import { EmailField } from './normalize-email.decorator.js';
import { NewPasswordField } from './new-password.decorator.js';
import {
  PrivacyVersionField,
  TermsVersionField,
  WhatsappConsentField,
} from '../../privacy/dto/signup-consent.fields.js';

// BR-001-31: these properties are the whole sign-up contract. forbidNonWhitelisted turns a
// `role`, `plan` or anything else into a 400 before an account exists. Beyond email, password and
// name, the others are consent artefacts, not account attributes (SPEC-010): `acceptTerms`, the
// versions the person saw and the WhatsApp checkbox.
export class RegisterDto {
  @EmailField()
  email!: string;

  @NewPasswordField()
  password!: string;

  @ApiProperty({ type: String })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  name!: string;

  // BR-001-02: sign-up requires accepting the current terms and privacy policy; a missing or false
  // value is a VALIDATION_FAILED before any account exists. SPEC-010 BR-010-03 records the acceptance
  // (the versions, the time, the method) once the account exists (AuthService.register).
  @ApiProperty({ type: Boolean, enum: [true], description: 'Must be true' })
  @Equals(true)
  acceptTerms!: true;

  // BR-010-01: the versions the person was shown; omitted means the current ones at the moment of
  // the request, a version that is not the current one is TERMS_VERSION_OUTDATED (409).
  @TermsVersionField()
  termsVersion?: string;

  @PrivacyVersionField()
  privacyVersion?: string;

  // BR-010-27: its own optional choice, never required; omitted or false is recorded as declined.
  @WhatsappConsentField()
  whatsappConsent?: boolean;
}
