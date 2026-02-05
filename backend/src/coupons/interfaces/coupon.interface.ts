export interface Coupon {
  _id: string;
  code: string;
  discountValue: number;
  validTo: Date;
  active: boolean;
  stripeCouponId: string | null;
  stripePromotionCodeId: string | null;
  description: string | null;
  createdAt: Date;
}
