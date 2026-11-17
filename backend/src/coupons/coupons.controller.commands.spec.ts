// HTTP contract of the remaining coupon endpoints (TESTING §2): invalidate (admin) and validate
// (any signed-in user, a narrower response), with CouponsService stubbed.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CouponsController } from './coupons.controller.js';
import { CouponsService } from './coupons.service.js';
import type { Coupon } from './interfaces/coupon.interface.js';
import { Decimal } from '../common/money/money.js';
import { DomainError } from '../common/errors/domain-error.js';
import { createHttpApp, TEST_USER } from '../../test/support/http-app.js';

const COUPON: Coupon = {
  _id: '64b7f00000000000000000dd',
  code: 'BEMVINDO',
  discountValue: new Decimal('12.5'),
  validTo: new Date('2026-12-31T00:00:00.000Z'),
  active: false,
  stripeCouponId: 'coupon_test',
  stripePromotionCodeId: 'promo_test',
  description: 'Welcome',
  createdAt: new Date('2026-01-15T12:00:00.000Z'),
};

describe('CouponsController commands over HTTP', () => {
  const coupons = { invalidate: vi.fn(), validateCoupon: vi.fn() };
  let admin: INestApplication;
  let subscriber: INestApplication;

  beforeAll(async () => {
    const metadata = {
      controllers: [CouponsController],
      providers: [{ provide: CouponsService, useValue: coupons }],
    };
    admin = await createHttpApp(metadata, { user: { ...TEST_USER, isAdmin: true } });
    subscriber = await createHttpApp(metadata);
  });

  afterAll(async () => {
    await admin.close();
    await subscriber.close();
  });

  beforeEach(() => {
    coupons.invalidate.mockResolvedValue(COUPON);
    coupons.validateCoupon.mockResolvedValue(COUPON);
  });

  it('PATCH /api/coupons/:id/invalidate answers the deactivated coupon to an admin', async () => {
    const res = await request(admin.getHttpServer())
      .patch(`/api/coupons/${COUPON._id}/invalidate`)
      .expect(200);

    expect(coupons.invalidate).toHaveBeenCalledWith(COUPON._id);
    expect(res.body).toEqual({
      _id: COUPON._id,
      code: 'BEMVINDO',
      discountValue: '12.50', // AR-17: reais as a string, two decimals
      validTo: '2026-12-31T00:00:00.000Z',
      active: false,
      stripeCouponId: 'coupon_test',
      stripePromotionCodeId: 'promo_test',
      description: 'Welcome',
      createdAt: '2026-01-15T12:00:00.000Z',
    });
  });

  it('PATCH /api/coupons/:id/invalidate answers 404 COUPON_NOT_FOUND for an unknown coupon', async () => {
    coupons.invalidate.mockRejectedValue(new DomainError('COUPON_NOT_FOUND'));

    const res = await request(admin.getHttpServer())
      .patch('/api/coupons/unknown/invalidate')
      .expect(404);

    expect(res.body).toEqual({ code: 'COUPON_NOT_FOUND', context: {} });
  });

  it('PATCH /api/coupons/:id/invalidate is refused for a non-admin before the service is asked', async () => {
    const res = await request(subscriber.getHttpServer())
      .patch(`/api/coupons/${COUPON._id}/invalidate`)
      .expect(403);

    expect(res.body.code).toBe('FORBIDDEN');
    expect(coupons.invalidate).not.toHaveBeenCalled();
  });

  it('POST /api/coupons/validate tells a customer only the code, discount, expiry and description', async () => {
    const res = await request(subscriber.getHttpServer())
      .post('/api/coupons/validate')
      .send({ code: 'BEMVINDO' })
      .expect(201);

    expect(coupons.validateCoupon).toHaveBeenCalledWith('BEMVINDO');
    expect(res.body).toEqual({
      code: 'BEMVINDO',
      discountValue: '12.50',
      validTo: '2026-12-31T00:00:00.000Z',
      description: 'Welcome',
    });
  });

  it('POST /api/coupons/validate answers 400 COUPON_INVALID for a code that cannot be used', async () => {
    coupons.validateCoupon.mockRejectedValue(new DomainError('COUPON_INVALID'));

    const res = await request(subscriber.getHttpServer())
      .post('/api/coupons/validate')
      .send({ code: 'OLD' })
      .expect(400);

    expect(res.body).toEqual({ code: 'COUPON_INVALID', context: {} });
  });

  it('POST /api/coupons/validate refuses an empty code', async () => {
    await request(subscriber.getHttpServer())
      .post('/api/coupons/validate')
      .send({ code: '' })
      .expect(400);

    expect(coupons.validateCoupon).not.toHaveBeenCalled();
  });
});
