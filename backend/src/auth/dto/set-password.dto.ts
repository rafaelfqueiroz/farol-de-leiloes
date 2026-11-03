import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class SetPasswordDto {
  @ApiProperty({ type: String, format: 'password', minLength: 6 })
  @IsString()
  @MinLength(6)
  @IsNotEmpty()
  newPassword!: string;
}
