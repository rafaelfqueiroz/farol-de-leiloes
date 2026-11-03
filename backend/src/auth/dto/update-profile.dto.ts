// AR-34: PATCH /auth/profile changes the name or the email, nothing else; any other property
// (role, password, providers) is refused by forbidNonWhitelisted.
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class UpdateProfileDto {
  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @ApiPropertyOptional({ type: String, format: 'email' })
  @IsOptional()
  @IsEmail()
  email?: string;
}
