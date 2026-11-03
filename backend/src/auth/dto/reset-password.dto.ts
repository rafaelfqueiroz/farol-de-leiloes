import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class RequestResetPasswordDto {
  @ApiProperty({ type: String, format: 'email' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ type: String, description: 'Token from the reset email' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ type: String, format: 'password', minLength: 6 })
  @IsString()
  @MinLength(6)
  @IsNotEmpty()
  newPassword!: string;
}
