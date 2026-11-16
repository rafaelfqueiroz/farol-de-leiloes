// AR-34: PATCH /auth/profile changes the name or the email, nothing else; any other property
// (role, password, providers) is refused by forbidNonWhitelisted.
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { normalizeEmail } from '../../common/normalize-email.js';

export class UpdateProfileDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ type: String, format: 'email' })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeEmail(value) : value,
  )
  @IsEmail()
  email?: string;
}
