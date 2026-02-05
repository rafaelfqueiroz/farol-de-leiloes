import { Coupon } from '../interfaces/coupon.interface';

export class CouponResponseDto {
  _id: string;
  code: string;
  discountValue: number;
  validTo: Date;
  active: boolean;
  stripeCouponId: string | null;
  stripePromotionCodeId: string | null;
  description: string | null;
  createdAt: Date;

  constructor(coupon: Coupon) {
    this._id = coupon._id;
    this.code = coupon.code;
    this.discountValue = coupon.discountValue;
    this.validTo = coupon.validTo;
    this.active = coupon.active;
    this.stripeCouponId = coupon.stripeCouponId;
    this.stripePromotionCodeId = coupon.stripePromotionCodeId;
    this.description = coupon.description;
    this.createdAt = coupon.createdAt;
  }
}

export class CouponValidationResponseDto {
  code: string;
  discountValue: number;
  validTo: Date;
  description: string | null;

  constructor(coupon: Coupon) {
    this.code = coupon.code;
    this.discountValue = coupon.discountValue;
    this.validTo = coupon.validTo;
    this.description = coupon.description;
  }
}
