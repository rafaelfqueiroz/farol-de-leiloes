// SPEC-010 BR-010-01, BR-010-03, BR-010-27: the optional acceptance fields a sign-up carries beside
// `acceptTerms: true`, for the e-mail sign-up and the Google completion alike. Decorators rather
// than a base class, because GoogleCompleteDto already extends GoogleCodeDto (AR-34: every
// validated property is documented).
import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { VERSION_PATTERN } from '../domain/legal-versions.js';

const versionField = (which: string) =>
  applyDecorators(
    ApiPropertyOptional({
      type: String,
      example: '0.1',
      description:
        `The version of the ${which} the person was shown. Omitted means the current one at the ` +
        'moment of the request; a version that is not the current one is TERMS_VERSION_OUTDATED (409) ' +
        'and nothing is created (BR-010-01).',
    }),
    IsOptional(),
    IsString(),
    MaxLength(32),
    Matches(VERSION_PATTERN),
  );

/** The terms version the person saw. */
export const TermsVersionField = () => versionField('terms of use');

/** The privacy policy version the person saw. */
export const PrivacyVersionField = () => versionField('privacy policy');

/** The WhatsApp checkbox: unticked by default, its own choice, never required (BR-010-27). */
export const WhatsappConsentField = () =>
  applyDecorators(
    ApiPropertyOptional({
      type: Boolean,
      default: false,
      description:
        'Consent to WhatsApp messages, separate from the terms and never required. Omitted or ' +
        'false is recorded as a refusal and the account is created all the same (BR-010-27).',
    }),
    IsOptional(),
    IsBoolean(),
  );
