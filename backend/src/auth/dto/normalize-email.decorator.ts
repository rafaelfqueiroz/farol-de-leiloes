import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, registerDecorator, type ValidationOptions } from 'class-validator';
import { isReservedEmailDomain, normalizeEmail } from '../../common/normalize-email.js';

/**
 * BR-001-01: an email arrives trimmed and lower-cased, so every layer below compares the same
 * value. The transform runs before validation (ValidationPipe `transform: true`).
 */
/** An address under the reserved `.invalid` TLD (RFC 6761) is refused; see `isReservedEmailDomain`. */
function IsNotReservedEmailDomain(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    registerDecorator({
      name: 'isNotReservedEmailDomain',
      target: target.constructor,
      propertyName: String(propertyKey),
      options: { message: 'email must not be under the reserved .invalid domain', ...options },
      validator: {
        validate: (value: unknown) => typeof value !== 'string' || !isReservedEmailDomain(value),
      },
    });
  };
}

export function EmailField() {
  return applyDecorators(
    ApiProperty({ type: String, format: 'email' }),
    Transform(({ value }: { value: unknown }) =>
      typeof value === 'string' ? normalizeEmail(value) : value,
    ),
    IsEmail(),
    IsNotReservedEmailDomain(),
    IsNotEmpty(),
  );
}
