import { applyDecorators } from '@nestjs/common';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, registerDecorator, type ValidationOptions } from 'class-validator';
import { normalizeBrazilianPhone } from '../domain/phone.js';

/** A Brazilian phone with area code (BR-001-27). Used on its own, or through `PhoneField`. */
export function IsBrazilianPhone(options?: ValidationOptions): PropertyDecorator {
  return (target, propertyKey) => {
    const propertyName = String(propertyKey);
    registerDecorator({
      name: 'isBrazilianPhone',
      target: target.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a Brazilian phone number with area code (DDD)`,
        ...options,
      },
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && normalizeBrazilianPhone(value) !== null,
      },
    });
  };
}

/**
 * The phone of an account in a request body (BR-001-27). Absent means "leave it"; an empty string
 * or `null` means "remove it" (the value becomes `null`, which the service turns into `$unset`);
 * anything else must be a Brazilian number and reaches the service as E.164 (`+5584999991234`).
 */
export function PhoneField() {
  return applyDecorators(
    ApiPropertyOptional({
      type: String,
      nullable: true,
      example: '(84) 99999-1234',
      description:
        'Brazilian number with area code; stored as E.164. Send an empty string or null to remove it.',
    }),
    Transform(({ value }: { value: unknown }) => {
      if (value === null || (typeof value === 'string' && value.trim() === '')) return null;
      return typeof value === 'string' ? (normalizeBrazilianPhone(value) ?? value) : value;
    }),
    IsOptional(), // skips null and undefined
    IsBrazilianPhone(),
  );
}
