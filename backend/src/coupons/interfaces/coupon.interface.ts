import type { Decimal } from '../../common/money/money.js';

export interface Coupon {
  _id: string;
  code: string;
  /** AR-17: the absolute discount in reais. */
  discountValue: Decimal;
  validTo: Date;
  active: boolean;
  stripeCouponId: string | null;
  stripePromotionCodeId: string | null;
  description: string | null;
  createdAt: Date;
}
