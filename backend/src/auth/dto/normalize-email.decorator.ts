import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty } from 'class-validator';
import { normalizeEmail } from '../../common/normalize-email.js';

/**
 * BR-001-01: an email arrives trimmed and lower-cased, so every layer below compares the same
 * value. The transform runs before validation (ValidationPipe `transform: true`).
 */
export function EmailField() {
  return applyDecorators(
    ApiProperty({ type: String, format: 'email' }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? normalizeEmail(value) : value,
    ),
    IsEmail(),
    IsNotEmpty(),
  );
}
