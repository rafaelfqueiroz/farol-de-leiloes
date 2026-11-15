import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { EmailField } from './normalize-email.decorator.js';
import { NewPasswordField } from './new-password.decorator.js';

export class RequestResetPasswordDto {
  @EmailField()
  email!: string;
}

export class ResetPasswordDto {
  @ApiProperty({ type: String, description: 'Token from the reset email' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  token!: string;

  @NewPasswordField()
  newPassword!: string;
}
