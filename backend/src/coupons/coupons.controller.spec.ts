// HTTP contract of GET /api/coupons (TESTING §2): pagination (AR-35) for an admin, and the role
// gate in front of it, with CouponsService stubbed and the signed-in user faked.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CouponsController } from './coupons.controller';
import { CouponsService } from './coupons.service';
import type { Coupon } from './interfaces/coupon.interface';
import { Decimal } from '../common/money/money';
import { createHttpApp, TEST_USER } from '../../test/support/http-app';
import { itAnswersPages } from '../../test/support/pagination-contract';

const COUPON: Coupon = {
  _id: '64b7f00000000000000000dd',
  code: 'BEMVINDO',
  discountValue: new Decimal('10'),
  validTo: new Date('2026-12-31T00:00:00.000Z'),
  active: true,
  stripeCouponId: 'coupon_test',
  stripePromotionCodeId: 'promo_test',
  description: null,
  createdAt: new Date('2026-01-15T12:00:00.000Z'),
};

describe('CouponsController over HTTP', () => {
  const coupons = { findPage: vi.fn() };

  describe('GET /api/coupons as an admin', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createHttpApp(
        {
          controllers: [CouponsController],
          providers: [{ provide: CouponsService, useValue: coupons }],
        },
        { user: { ...TEST_USER, role: 'admin' } },
      );
    });

    afterAll(async () => {
      await app.close();
    });

    itAnswersPages({
      app: () => app,
      path: '/api/coupons',
      method: coupons.findPage,
      pageArg: 0,
      item: COUPON,
      expectedItem: {
        ...COUPON,
        discountValue: '10.00', // AR-17: reais as a string, no longer centavos
        validTo: '2026-12-31T00:00:00.000Z',
        createdAt: '2026-01-15T12:00:00.000Z',
      },
    });
  });

  describe('GET /api/coupons as a subscriber', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createHttpApp({
        controllers: [CouponsController],
        providers: [{ provide: CouponsService, useValue: coupons }],
      });
    });

    afterAll(async () => {
      await app.close();
    });

    it('is refused before the service is asked', async () => {
      const response = await request(app.getHttpServer()).get('/api/coupons').expect(403);

      expect(response.body.code).toBe('PLAN_NOT_ALLOWED');
      expect(coupons.findPage).not.toHaveBeenCalled();
    });
  });
});
