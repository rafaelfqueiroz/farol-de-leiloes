import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength } from 'class-validator';
import { VERSION_PATTERN } from '../domain/legal-versions.js';

/**
 * POST /privacy/accept (BR-010-05): the versions the account read and accepts. Both are required
 * and must be the current ones, so an acceptance can never be recorded for a text the person was
 * not shown (TERMS_VERSION_OUTDATED otherwise).
 */
export class AcceptTermsDto {
  @ApiProperty({ type: String, example: '0.1', description: 'Version of the terms of use' })
  @IsString()
  @MaxLength(32)
  @Matches(VERSION_PATTERN)
  termsVersion!: string;

  @ApiProperty({ type: String, example: '0.1', description: 'Version of the privacy policy' })
  @IsString()
  @MaxLength(32)
  @Matches(VERSION_PATTERN)
  privacyVersion!: string;
}
