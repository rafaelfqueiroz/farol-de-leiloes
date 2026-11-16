import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { EmailField } from './normalize-email.decorator.js';

export class LoginDto {
  @EmailField()
  email!: string;

  // No length rule here: sign-in must accept whatever the account was created with (BR-001-14).
  @ApiProperty({ type: String, format: 'password' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
