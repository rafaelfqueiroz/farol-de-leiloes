import { IsString, IsNotEmpty, IsNumber, IsDateString, IsOptional, Min, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

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
  @IsString()
  @IsNotEmpty()
  code!: string;

  @IsNumber()
  @IsNotEmpty()
  @Min(1)
  discountValue!: number; // absolute discount in cents (BRL)

  @IsDateString()
  @IsNotEmpty()
  @Validate(IsFutureDateConstraint)
  validTo!: string;

  @IsString()
  @IsOptional()
  description?: string;
}
