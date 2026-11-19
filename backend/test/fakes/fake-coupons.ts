import { Decimal } from '../../src/common/money/money.js';
import { DomainError } from '../../src/common/errors/domain-error.js';
import type { Coupon } from '../../src/coupons/interfaces/coupon.interface.js';
import type { CouponsService } from '../../src/coupons/coupons.service.js';

type Port<T> = { [K in keyof T]: T[K] };

/**
 * TS-03: the slice of `CouponsService` that checkout reads, over an in-memory list. A code it does
 * not know is COUPON_INVALID, like the real service (expiry and deactivation included).
 */
export class FakeCoupons implements Pick<Port<CouponsService>, 'validateCoupon'> {
  readonly coupons = new Map<string, Coupon>();

  add(code: string, overrides: Partial<Coupon> = {}): Coupon {
    const coupon: Coupon = {
      _id: '64b7f0000000000000000d01',
      code,
      discountValue: new Decimal('20'),
      validTo: new Date('2099-01-01T00:00:00.000Z'),
      active: true,
      stripeCouponId: 'coupon_fake_1',
      stripePromotionCodeId: 'promo_fake_1',
      description: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    };
    this.coupons.set(code.toUpperCase(), coupon);
    return coupon;
  }

  async validateCoupon(code: string): Promise<Coupon> {
    const coupon = this.coupons.get(code.toUpperCase());
    if (!coupon?.active) throw new DomainError('COUPON_INVALID');
    return coupon;
  }
}
