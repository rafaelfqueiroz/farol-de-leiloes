// HTTP contract of GET /api/coupons (TESTING §2): pagination (AR-35) for an admin, and the role
// gate in front of it, with CouponsService stubbed and the signed-in user faked.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CouponsController } from './coupons.controller.js';
import { CouponsService } from './coupons.service.js';
import type { Coupon } from './interfaces/coupon.interface.js';
import { Decimal } from '../common/money/money.js';
import { createHttpApp, TEST_USER } from '../../test/support/http-app.js';
import { itAnswersPages } from '../../test/support/pagination-contract.js';

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
        { user: { ...TEST_USER, isAdmin: true } },
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

  describe('POST /api/coupons as an admin', () => {
    const create = vi.fn();
    let app: INestApplication;

    beforeAll(async () => {
      app = await createHttpApp(
        {
          controllers: [CouponsController],
          providers: [{ provide: CouponsService, useValue: { ...coupons, create } }],
        },
        { user: { ...TEST_USER, isAdmin: true } },
      );
    });

    afterAll(async () => {
      await app.close();
    });

    it('AR-17: hands the discount to the service as a Decimal made from the reais string', async () => {
      create.mockResolvedValue(COUPON);

      await request(app.getHttpServer())
        .post('/api/coupons')
        .send({ code: 'TEST', discountValue: '10.00', validTo: '2099-01-01' })
        .expect(201);

      expect(create).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'TEST', discountValue: new Decimal('10') }),
      );
    });

    it.each([
      ['a JSON number (centavos)', 1000],
      ['a forged Decimal object (SC-10)', { toStringTag: '[object Decimal]' }],
    ])(
      'SC-10 / AR-34: refuses %s as VALIDATION_FAILED, not a 500',
      async (_label, discountValue) => {
        create.mockClear();

        await request(app.getHttpServer())
          .post('/api/coupons')
          .send({ code: 'TEST', discountValue, validTo: '2099-01-01' })
          .expect(400, { code: 'VALIDATION_FAILED', context: { fields: ['discountValue'] } });

        expect(create).not.toHaveBeenCalled();
      },
    );
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

      expect(response.body.code).toBe('FORBIDDEN');
      expect(coupons.findPage).not.toHaveBeenCalled();
    });
  });

  // SPEC-002 BR-002-23: the plan tier `role: 'admin'` is no admin capability any more.
  describe("GET /api/coupons with the legacy role 'admin' but no isAdmin", () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createHttpApp(
        {
          controllers: [CouponsController],
          providers: [{ provide: CouponsService, useValue: coupons }],
        },
        { user: { ...TEST_USER, role: 'admin', isAdmin: false } },
      );
    });

    afterAll(async () => {
      await app.close();
    });

    it('is refused before the service is asked', async () => {
      const response = await request(app.getHttpServer()).get('/api/coupons').expect(403);

      expect(response.body).toEqual({ code: 'FORBIDDEN', context: {} });
      expect(coupons.findPage).not.toHaveBeenCalled();
    });
  });
});
