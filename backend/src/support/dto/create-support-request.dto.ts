import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

export class CreateSupportRequestDto {
  @ApiProperty({ type: String, minLength: 3, maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ type: String, minLength: 10, maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(2000)
  description!: string;
}
