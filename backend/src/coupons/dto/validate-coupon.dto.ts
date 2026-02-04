import { IsString, IsNotEmpty } from 'class-validator';

export class ValidateCouponDto {
  @IsString()
  @IsNotEmpty()
  code!: string;
}
