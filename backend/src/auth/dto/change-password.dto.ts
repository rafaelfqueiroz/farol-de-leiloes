import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ type: String, format: 'password' })
  @IsString()
  @IsNotEmpty()
  currentPassword!: string;

  // The same rule as registration and set-password.
  @ApiProperty({ type: String, format: 'password', minLength: 6 })
  @IsString()
  @MinLength(6)
  @IsNotEmpty()
  newPassword!: string;
}
