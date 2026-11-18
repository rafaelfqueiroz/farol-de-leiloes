// SPEC-012 BR-012-05, AR-33, AR-35, AR-36, SC-07: GET /api/plans is public and answers the offered
// catalog as `{ items }` with the price as a money string and nothing internal, over HTTP with the
// service stubbed (TESTING §2).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { Decimal } from '../common/money/money.js';
import { aPlan } from '../../test/builders/plan.builder.js';
import { createHttpApp } from '../../test/support/http-app.js';
import { testBusinessConfig, testEnv } from '../../test/support/test-env.js';
import businessConfig from '../config/business.config.js';
import { PlansController } from './plans.controller.js';
import { PlansThrottlerModule } from './plans-throttler.module.js';
import { PlansService } from './plans.service.js';

describe('PlansController over HTTP', () => {
  const plans = { listOffered: vi.fn() };
  let app: INestApplication;

  beforeAll(async () => {
    app = await createHttpApp({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: () => testEnv() }),
        PlansThrottlerModule,
      ],
      controllers: [PlansController],
      providers: [
        { provide: PlansService, useValue: plans },
        { provide: businessConfig.KEY, useValue: testBusinessConfig({ REFUND_WINDOW_DAYS: '14' }) },
      ],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('BR-012-05: lists every offered plan with price, interval and limit, and nothing internal', async () => {
    plans.listOffered.mockResolvedValue([
      aPlan({ code: 'a', name: 'A', price: new Decimal('99.9'), activeJourneyLimit: 2 }),
      aPlan({
        code: 'b',
        name: 'B',
        price: new Decimal('1234.5'),
        interval: 'year',
        activeJourneyLimit: 9,
      }),
    ]);

    const response = await request(app.getHttpServer()).get('/api/plans').expect(200);

    // AR-17: reais as strings with two places, never a number.
    expect(response.body).toEqual({
      items: [
        { code: 'a', name: 'A', price: '99.90', interval: 'month', activeJourneyLimit: 2 },
        { code: 'b', name: 'B', price: '1234.50', interval: 'year', activeJourneyLimit: 9 },
      ],
      // AR-43: the refund notice's number is the setting, not a constant of the page
      refundWindowDays: 14,
    });
  });

  it('BR-012-05: the public catalog is cached for 30 seconds by browsers and proxies', async () => {
    plans.listOffered.mockResolvedValue([]);

    const response = await request(app.getHttpServer()).get('/api/plans').expect(200);

    expect(response.headers['cache-control']).toBe('public, max-age=30');
  });

  it('answers an empty envelope when nothing is offered (AR-35: an object, never a bare array)', async () => {
    plans.listOffered.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get('/api/plans')
      .expect(200, { items: [], refundWindowDays: 14 });
  });
});
