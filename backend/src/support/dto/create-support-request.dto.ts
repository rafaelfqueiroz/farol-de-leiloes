import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsString, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { singleLine } from '../../common/text/single-line.js';
import { MESSAGE_LENGTH, SUBJECT_LENGTH } from '../domain/support-request.js';

/** Trims the text before it is measured, so a text of only spaces has no length (BR-009-05). */
const trimmed = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** A subject is one line (BR-009-05): no line break, control or bidi character, then trimmed before it is measured. */
const oneLine = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? singleLine(value) : value;

/**
 * POST /api/support (BR-009-04, BR-009-05, BR-009-08): the subject and the message of a request, and
 * the option to let the support team view the requester's data in the product (unticked by default).
 * Whose request it is comes from the session, never from the body (BR-002-11: a body naming a
 * `userId` is refused by the whitelist, as is the former `title` / `description`).
 */
export class CreateSupportRequestDto {
  @ApiProperty({
    type: String,
    minLength: SUBJECT_LENGTH.min,
    maxLength: SUBJECT_LENGTH.max,
    description:
      'What the request is about, on one line (line breaks and control characters become spaces); then 3 to 200 characters',
  })
  @Transform(oneLine)
  @IsString()
  @MinLength(SUBJECT_LENGTH.min)
  @MaxLength(SUBJECT_LENGTH.max)
  subject!: string;

  @ApiProperty({
    type: String,
    minLength: MESSAGE_LENGTH.min,
    maxLength: MESSAGE_LENGTH.max,
    description: 'The message, as plain text; trimmed, then 10 to 5,000 characters',
  })
  @Transform(trimmed)
  @IsString()
  @MinLength(MESSAGE_LENGTH.min)
  @MaxLength(MESSAGE_LENGTH.max)
  message!: string;

  @ApiPropertyOptional({
    type: Boolean,
    default: false,
    description:
      'Allows the support team to view the data in the product needed to solve this request ' +
      '(BR-009-08). The requester can withdraw it while the request is open.',
  })
  // Absent means false; `null` is not absent (class-validator's IsOptional would let it through to a
  // 500 at the database): only `undefined` skips the check.
  @ValidateIf((_dto, value) => value !== undefined)
  @IsBoolean()
  allowDataAccess: boolean = false;
}
