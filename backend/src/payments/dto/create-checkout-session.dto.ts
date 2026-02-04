import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateCheckoutSessionDto {
  @IsString()
  @IsNotEmpty()
  planId!: string; // 'standard' for now

  @IsString()
  @IsOptional()
  couponCode?: string;
}
