import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsDateString,
  IsOptional,
  Min,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'isFutureDate', async: false })
class IsFutureDateConstraint implements ValidatorConstraintInterface {
  validate(value: string) {
    const date = new Date(value);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return date >= today;
  }

  defaultMessage() {
    return 'A data de validade deve ser uma data futura';
  }
}

export class CreateCouponDto {
  @ApiProperty({ type: String, description: 'Stored upper-cased' })
  @IsString()
  @IsNotEmpty()
  code!: string;

  @ApiProperty({ type: 'integer', minimum: 1, description: 'Absolute discount in BRL cents' })
  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  discountValue!: number; // absolute discount in cents (BRL)

  @ApiProperty({ type: String, format: 'date-time', description: 'Today or later' })
  @IsDateString()
  @IsNotEmpty()
  @Validate(IsFutureDateConstraint)
  validTo!: string;

  @ApiPropertyOptional({ type: String })
  @IsString()
  @IsOptional()
  description?: string;
}
