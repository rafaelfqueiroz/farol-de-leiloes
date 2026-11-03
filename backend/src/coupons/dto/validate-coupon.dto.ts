import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';

export class ValidateCouponDto {
  @ApiProperty({ type: String, description: 'Case-insensitive' })
  @IsString()
  @IsNotEmpty()
  code!: string;
}
