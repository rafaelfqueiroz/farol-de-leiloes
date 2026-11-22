import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { Equals, IsBoolean, IsNotEmpty, IsString, MaxLength, ValidateIf } from 'class-validator';
import type { ReauthenticationProof } from '../../../auth/auth.service.js';
import { DomainError } from '../../../common/errors/domain-error.js';

/**
 * POST /privacy/delete-account (BR-010-13): the account holder asks for the account to be deleted,
 * after proving their identity AGAIN with exactly one of the two proofs. Whose account it is comes
 * from the session, never from the body (BR-002-11: a body naming a `userId` is refused).
 */
export class DeleteAccountDto {
  @ApiPropertyOptional({
    type: String,
    format: 'password',
    description: 'The current password. Exactly one of `password` and `googleCode`',
  })
  // Absent is fine (the other proof is used); anything PRESENT, null included, must be a string.
  @ValidateIf((dto: DeleteAccountDto) => dto.password !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(1024) // no length rule of the account's own password (BR-001-14), only a bound on input
  password?: string;

  @ApiPropertyOptional({
    type: String,
    description:
      'The one-time `code` of a fresh Google sign-in of THIS account (the redirect of ' +
      '/auth/google/callback). Exactly one of `password` and `googleCode`',
  })
  @ValidateIf((dto: DeleteAccountDto) => dto.googleCode !== undefined)
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  googleCode?: string;

  @ApiProperty({ type: Boolean, enum: [true], description: 'Must be true: the person confirmed' })
  @IsBoolean()
  @Equals(true)
  confirm!: boolean;

  /** The one proof the request carries; VALIDATION_FAILED when it carries none or both. */
  proof(): ReauthenticationProof {
    if (this.password !== undefined && this.googleCode === undefined) {
      return { password: this.password };
    }
    if (this.googleCode !== undefined && this.password === undefined) {
      return { googleCode: this.googleCode };
    }
    throw new DomainError('VALIDATION_FAILED', { fields: ['password', 'googleCode'] });
  }
}

/** AR-36: the closure's answer. */
export class AccountClosureResponseDto {
  @ApiProperty({ type: Boolean, enum: [true], description: 'The account is closed' })
  closed = true as const;
}
