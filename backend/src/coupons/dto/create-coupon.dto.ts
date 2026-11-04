import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsDateString, IsOptional } from 'class-validator';
import type { Decimal } from '../../common/money/money';
import { IsMoneyString, MONEY_API_PROPERTY } from '../../common/money/money-dto';

export class CreateCouponDto {
  @ApiProperty({ type: String, description: 'Stored upper-cased' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  // AR-17: reais as a string; Stripe's centavos are the payment adapter's concern (AR-20).
  @ApiProperty({
    ...MONEY_API_PROPERTY,
    example: '10.00',
    description: 'Absolute discount in BRL (reais), at least 0.01',
  })
  @IsMoneyString({ positive: true })
  discountValue!: Decimal;

  // "Today or later" is a rule about now, so CouponsService checks it against the Clock
  // (AR-24); the DTO only checks the shape. A date without a time is read in Brasília (AR-23).
  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Today (Brasília) or later; a bare YYYY-MM-DD is midnight in Brasília',
  })
  @IsDateString()
  @IsNotEmpty()
  validTo!: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  description?: string;
}
