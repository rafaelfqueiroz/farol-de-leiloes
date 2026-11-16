// BR-001-25, BR-001-27, BR-001-29, BR-001-31 (RNF-13): PATCH /auth/profile accepts this closed
// list and nothing else. forbidNonWhitelisted turns any other property (role, plan, status,
// providers, emailVerified...) into a 400 that changes nothing, whatever else the body carries.
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';
import { normalizeEmail } from '../../common/normalize-email.js';
import { PhoneField } from '../../users/dto/phone-field.decorator.js';

export const NAME_MAX_LENGTH = 120;

export class UpdateProfileDto {
  @ApiPropertyOptional({ type: String, maxLength: NAME_MAX_LENGTH })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(NAME_MAX_LENGTH)
  name?: string;

  // BR-001-26 / D-63: the email of an account cannot be changed by anyone. It stays in this DTO
  // only because the profile page still sends it with the name; it is accepted when it repeats
  // the current address (a no-op) and refused otherwise. The frontend profile work drops it.
  @ApiPropertyOptional({
    type: String,
    format: 'email',
    description:
      'Read-only (BR-001-26): must equal the current address; a different one is refused with EMAIL_CHANGE_UNAVAILABLE.',
  })
  // Absent is fine, but `null` is a value like any other here (`@IsOptional` would let it through
  // and normalizeEmail(null) threw a 500): only `undefined` skips validation (SC-10, AR-34).
  @ValidateIf((_object: unknown, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsString()
  @IsEmail()
  email?: string;

  @PhoneField()
  phone?: string | null;
}
