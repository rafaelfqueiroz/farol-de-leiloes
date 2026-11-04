// AR-36: a coupon leaves the API through these classes, each field copied explicitly.
import { ApiProperty } from '@nestjs/swagger';
import { Coupon } from '../interfaces/coupon.interface';
import { MONEY_API_PROPERTY, moneyToJson } from '../../common/money/money-dto';

export class CouponResponseDto {
  @ApiProperty({ type: String })
  _id: string;

  @ApiProperty({ type: String })
  code: string;

  // AR-17: reais as a string (was integer centavos before #34).
  @ApiProperty({ ...MONEY_API_PROPERTY, example: '10.00', description: 'Absolute discount in BRL' })
  discountValue: string;

  @ApiProperty({ type: String, format: 'date-time' })
  validTo: Date;

  @ApiProperty({ type: Boolean })
  active: boolean;

  @ApiProperty({ type: String, nullable: true })
  stripeCouponId: string | null;

  @ApiProperty({ type: String, nullable: true })
  stripePromotionCodeId: string | null;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  constructor(coupon: Coupon) {
    this._id = coupon._id;
    this.code = coupon.code;
    this.discountValue = moneyToJson(coupon.discountValue);
    this.validTo = coupon.validTo;
    this.active = coupon.active;
    this.stripeCouponId = coupon.stripeCouponId;
    this.stripePromotionCodeId = coupon.stripePromotionCodeId;
    this.description = coupon.description;
    this.createdAt = coupon.createdAt;
  }
}

/** What a customer learns about a valid coupon: no Stripe ids, no admin fields. */
export class CouponValidationResponseDto {
  @ApiProperty({ type: String })
  code: string;

  // AR-17: reais as a string (was integer centavos before #34).
  @ApiProperty({ ...MONEY_API_PROPERTY, example: '10.00', description: 'Absolute discount in BRL' })
  discountValue: string;

  @ApiProperty({ type: String, format: 'date-time' })
  validTo: Date;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  constructor(coupon: Coupon) {
    this.code = coupon.code;
    this.discountValue = moneyToJson(coupon.discountValue);
    this.validTo = coupon.validTo;
    this.description = coupon.description;
  }
}
