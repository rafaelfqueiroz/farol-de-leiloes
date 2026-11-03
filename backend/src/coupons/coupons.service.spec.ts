// CouponsService with the payment provider faked (TS-03) and time from FakeClock (TS-06):
// discounts are reais in, Decimal128 at rest (AR-17), centavos only past the port (AR-20);
// "today" is today in Brasília (AR-23, TS-11).
import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { CouponsService } from './coupons.service';
import type { CreateCouponDto } from './dto/create-coupon.dto';
import { DomainError } from '../common/errors/domain-error';
import { Decimal } from '../common/money/money';
import { FakeClock } from '../../test/fakes/fake-clock';
import { FakePaymentGateway } from '../../test/fakes/fake-payment-gateway';

type ServiceDeps = ConstructorParameters<typeof CouponsService>;

const CREATED = new Date('2026-01-10T12:00:00.000Z');

/** A model stub: `new model(data)` keeps data; save() answers it as a stored document. */
function build(now: Date, found: Record<string, unknown> | null = null) {
  const saved: Record<string, unknown>[] = [];
  function CouponModel(this: Record<string, unknown>, data: Record<string, unknown>) {
    Object.assign(this, data, {
      _id: new Types.ObjectId('64b7f00000000000000000dd'),
      createdAt: CREATED,
      save: async () => {
        saved.push(data);
        return this;
      },
    });
  }
  CouponModel.findOne = vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(found) });
  const gateway = new FakePaymentGateway();
  const service = new CouponsService(
    CouponModel as unknown as ServiceDeps[0],
    gateway,
    new FakeClock(now),
  );
  return { service, gateway, saved };
}

function dto(validTo: string, discountValue = '25.50'): CreateCouponDto {
  return { code: 'bemvindo', discountValue: new Decimal(discountValue), validTo };
}

describe('CouponsService.create', () => {
  it('asks the provider for the discount in reais and stores it as Decimal128 reais', async () => {
    const { service, gateway, saved } = build(new Date('2026-01-15T12:00:00.000Z'));

    const coupon = await service.create(dto('2026-12-31'));

    // A bare date is midnight in Brasília: 2026-12-31T03:00Z.
    const validTo = new Date('2026-12-31T03:00:00.000Z');
    expect(gateway.discountAmounts()).toEqual(['25.5']);
    expect(gateway.discounts[0]).toMatchObject({ code: 'BEMVINDO', expiresAt: validTo });
    expect(saved).toEqual([
      expect.objectContaining({
        code: 'BEMVINDO',
        discountValue: Types.Decimal128.fromString('25.5'),
        validTo,
        stripeCouponId: 'coupon_fake_1',
        stripePromotionCodeId: 'promo_fake_1',
        active: true,
      }),
    ]);
    expect(coupon.discountValue).toEqual(new Decimal('25.5'));
  });

  it('keeps the offset of a full ISO instant', async () => {
    const { service, gateway } = build(new Date('2026-01-15T12:00:00.000Z'));

    await service.create(dto('2026-06-30T23:59:59Z'));

    expect(gateway.discounts[0]?.expiresAt).toEqual(new Date('2026-06-30T23:59:59.000Z'));
  });

  // TS-11: at 23:59 in Brasília on 14/01 (02:59 UTC on 15/01) it is still 14/01 here, so a coupon
  // valid to 14/01 is accepted; one minute past midnight in Brasília it is refused.
  it('accepts a coupon valid to today in Brasília, up to the last minute of the day', async () => {
    const { service } = build(new Date('2026-01-15T02:59:00.000Z'));

    await expect(service.create(dto('2026-01-14'))).resolves.toMatchObject({ code: 'BEMVINDO' });
  });

  it('refuses a coupon valid to yesterday in Brasília, without asking the provider', async () => {
    const { service, gateway } = build(new Date('2026-01-15T03:00:00.000Z'));

    await expect(service.create(dto('2026-01-14'))).rejects.toEqual(
      new DomainError('VALIDATION_FAILED', { fields: ['validTo'] }),
    );
    expect(gateway.discounts).toEqual([]);
  });

  it('refuses a date it cannot read', async () => {
    const { service } = build(new Date('2026-01-15T12:00:00.000Z'));

    await expect(service.create(dto('2026-02-30'))).rejects.toEqual(
      new DomainError('VALIDATION_FAILED', { fields: ['validTo'] }),
    );
  });
});

describe('CouponsService.validateCoupon', () => {
  const stored = (overrides: Record<string, unknown> = {}) => ({
    _id: new Types.ObjectId('64b7f00000000000000000dd'),
    code: 'BEMVINDO',
    discountValue: Types.Decimal128.fromString('10'),
    validTo: new Date('2026-01-31T03:00:00.000Z'),
    active: true,
    createdAt: CREATED,
    ...overrides,
  });

  it('answers a valid coupon until the instant it expires, by the clock', async () => {
    const at = (now: string) => build(new Date(now), stored()).service.validateCoupon('bemvindo');

    await expect(at('2026-01-31T02:59:59.999Z')).resolves.toMatchObject({ code: 'BEMVINDO' });
    await expect(at('2026-01-31T03:00:00.000Z')).resolves.toMatchObject({ code: 'BEMVINDO' });
    await expect(at('2026-01-31T03:00:00.001Z')).rejects.toEqual(new DomainError('COUPON_INVALID'));
  });

  it('refuses an inactive or unknown coupon', async () => {
    const now = new Date('2026-01-15T12:00:00.000Z');

    await expect(build(now, stored({ active: false })).service.validateCoupon('X')).rejects.toEqual(
      new DomainError('COUPON_INVALID'),
    );
    await expect(build(now, null).service.validateCoupon('X')).rejects.toEqual(
      new DomainError('COUPON_INVALID'),
    );
  });

  it('EXPAND: reads a legacy coupon of 1000 centavos as R$ 10,00', async () => {
    const legacy = stored({ discountValue: 1000 });

    const coupon = await build(new Date('2026-01-15T12:00:00.000Z'), legacy).service.validateCoupon(
      'bemvindo',
    );

    expect(coupon.discountValue).toEqual(new Decimal('10'));
  });
});

describe('CouponsService.invalidate', () => {
  function withCoupon(coupon: Record<string, unknown> | null) {
    const gateway = new FakePaymentGateway();
    const model = {
      findById: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(coupon) }),
    };
    const service = new CouponsService(
      model as unknown as ServiceDeps[0],
      gateway,
      new FakeClock(),
    );
    return { service, gateway };
  }

  const document = () => {
    const doc: Record<string, unknown> = {
      _id: new Types.ObjectId('64b7f00000000000000000dd'),
      code: 'BEMVINDO',
      discountValue: Types.Decimal128.fromString('10'),
      validTo: new Date('2026-12-31T03:00:00.000Z'),
      active: true,
      stripePromotionCodeId: 'promo_1',
      createdAt: CREATED,
    };
    doc.save = async () => doc;
    return doc;
  };

  it('deactivates the promotion code at the provider and the coupon here', async () => {
    const { service, gateway } = withCoupon(document());

    await expect(service.invalidate('id')).resolves.toMatchObject({ active: false });
    expect(gateway.deactivatedPromotionCodes).toEqual(['promo_1']);
  });

  it('still deactivates the coupon when the provider fails', async () => {
    const { service, gateway } = withCoupon(document());
    gateway.failDeactivation = true;

    await expect(service.invalidate('id')).resolves.toMatchObject({ active: false });
  });

  it('answers COUPON_NOT_FOUND for an unknown id', async () => {
    await expect(withCoupon(null).service.invalidate('id')).rejects.toEqual(
      new DomainError('COUPON_NOT_FOUND'),
    );
  });
});
