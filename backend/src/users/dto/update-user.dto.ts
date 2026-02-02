import { IsEmail, IsOptional, IsString, MinLength, IsArray, IsEnum } from 'class-validator';

export class UpdateUserDto {
  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @MinLength(6)
  @IsOptional()
  password?: string;

  @IsArray()
  @IsEnum(['local', 'google'], { each: true })
  @IsOptional()
  providers?: string[];

  @IsString()
  @IsOptional()
  googleId?: string;
}
