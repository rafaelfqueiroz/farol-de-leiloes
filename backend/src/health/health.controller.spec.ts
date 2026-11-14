// AR-48: GET /api/health over HTTP — public, 200 unless the database is down, no details. The
// service is stubbed (its data is covered by test/integration/health.spec.ts); supertest binds an
// ephemeral loopback port in this process (TS-01, TS-07).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import request from 'supertest';
import { createHttpApp } from '../../test/support/http-app.js';
import type { HealthReport } from './domain/health-report.js';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';

const OK: HealthReport = {
  status: 'ok',
  database: { status: 'up' },
  lastImport: {
    status: 'SUCCESS',
    finishedAt: '2026-01-15T06:00:00.000Z',
    ageHours: 6,
    stale: false,
  },
};

describe('GET /api/health (AR-48)', () => {
  let app: INestApplication;
  let report: HealthReport = OK;
  const health = { check: async () => report };

  beforeAll(async () => {
    app = await createHttpApp({
      controllers: [HealthController],
      providers: [{ provide: HealthService, useValue: health }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    report = OK;
  });

  it('is public: no guard, and an unauthenticated request gets 200', async () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, HealthController)).toBeUndefined();
    expect(Reflect.getMetadata(GUARDS_METADATA, HealthController.prototype.check)).toBeUndefined();

    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(response.body).toEqual(OK);
  });

  it('answers 200 when degraded: the API still serves', async () => {
    report = { ...OK, status: 'degraded', lastImport: { ...OK.lastImport, status: 'FAILED' } };

    const response = await request(app.getHttpServer()).get('/api/health').expect(200);

    expect(response.body.status).toBe('degraded');
  });

  it('answers 503 when the database is down', async () => {
    report = { ...OK, status: 'down', database: { status: 'down' } };

    const response = await request(app.getHttpServer()).get('/api/health').expect(503);

    expect(response.body).toEqual({ ...OK, status: 'down', database: { status: 'down' } });
  });

  it('echoes the request id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/health')
      .set('x-request-id', 'probe-0123-abcd');
    expect(response.headers['x-request-id']).toBe('probe-0123-abcd');
  });
});
