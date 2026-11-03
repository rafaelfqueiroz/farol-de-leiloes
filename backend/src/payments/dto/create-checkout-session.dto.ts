import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateCheckoutSessionDto {
  // Any other value is refused as INVALID_PLAN by the service.
  @ApiProperty({ type: String, description: "The plan to subscribe to; only 'standard' for now" })
  @IsString()
  @IsNotEmpty()
  planId!: string;

  @ApiPropertyOptional({ type: String, description: 'Coupon code to apply at checkout' })
  @IsString()
  @IsOptional()
  couponCode?: string;
}
