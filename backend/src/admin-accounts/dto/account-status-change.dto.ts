import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { singleLine } from '../../common/text/single-line.js';
import { NOTE_LENGTH, REASON_LENGTH } from '../domain/account-status-change.js';

/** One line of text, trimmed before it is measured (no line break, control or bidi character). */
const oneLine = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? singleLine(value) : value;

/** POST /api/admin/accounts/:id/deactivate (BR-009-15): the required reason. Nothing else is accepted. */
export class DeactivateAccountDto {
  @ApiProperty({
    type: String,
    minLength: REASON_LENGTH.min,
    maxLength: REASON_LENGTH.max,
    description:
      'Why the account is deactivated: one line, 3 to 500 characters. Kept in the account’s history; do not write personal details in it',
  })
  @Transform(oneLine)
  @IsString()
  @MinLength(REASON_LENGTH.min)
  @MaxLength(REASON_LENGTH.max)
  reason!: string;
}

/** POST /api/admin/accounts/:id/reactivate (BR-009-17): an optional note. Nothing else is accepted. */
export class ReactivateAccountDto {
  @ApiPropertyOptional({
    type: String,
    maxLength: NOTE_LENGTH.max,
    description: 'An optional note kept in the account’s history: one line, up to 500 characters',
  })
  @IsOptional()
  @Transform(oneLine)
  @IsString()
  @MaxLength(NOTE_LENGTH.max)
  note?: string;
}
