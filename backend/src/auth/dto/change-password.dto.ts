import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { NewPasswordField } from './new-password.decorator.js';

export class ChangePasswordDto {
  // BR-001-28: the current password is required on accounts that have one.
  @ApiProperty({ type: String, format: 'password' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  @NewPasswordField()
  newPassword!: string;
}
