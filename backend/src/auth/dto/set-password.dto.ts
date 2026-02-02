import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class SetPasswordDto {
  @IsString()
  @MinLength(6)
  @IsNotEmpty()
  newPassword!: string;
}
