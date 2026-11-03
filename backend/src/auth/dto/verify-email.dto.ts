import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ type: String, description: 'Token from the verification email' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}
