// HTTP contract of the maintenance endpoints (TESTING §2), MaintenanceService stubbed:
// BR-003-03's public banner feed (anonymous, no createdBy), the admin role gate, and the request
// validation (AR-34). The data itself is covered by test/integration/maintenance.spec.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DomainError } from '../common/errors/domain-error.js';
import type { MaintenanceRecord } from './maintenance-record.js';
import { MaintenanceController } from './maintenance.controller.js';
import { MaintenanceService } from './maintenance.service.js';
import { createHttpApp, TEST_USER } from '../../test/support/http-app.js';
import { itAnswersPages } from '../../test/support/pagination-contract.js';

const RECORD: MaintenanceRecord = {
  id: '64b7f00000000000000000aa',
  startsAt: new Date('2026-03-10T05:00:00.000Z'),
  endsAt: new Date('2026-03-10T07:00:00.000Z'),
  message: 'Manutenção programada',
  // 2026-03-07T05:00Z -> 2026-03-10T05:00Z = 72 h: announced in time
  announcedAt: new Date('2026-03-07T05:00:00.000Z'),
  createdBy: '64b7f0000000000000000001',
  createdAt: new Date('2026-03-07T05:00:00.000Z'),
};

const BODY = {
  startsAt: '2026-03-10T02:00:00-03:00',
  endsAt: '2026-03-10T04:00:00-03:00',
  message: 'Manutenção programada',
};

describe('MaintenanceController over HTTP', () => {
  const maintenance = {
    upcoming: vi.fn(),
    findPage: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  };
  let admin: INestApplication;
  let standard: INestApplication;

  beforeAll(async () => {
    const metadata = {
      controllers: [MaintenanceController],
      providers: [{ provide: MaintenanceService, useValue: maintenance }],
    };
    admin = await createHttpApp(metadata, { user: { ...TEST_USER, isAdmin: true } });
    standard = await createHttpApp(metadata);
  });

  afterAll(async () => {
    await admin.close();
    await standard.close();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    maintenance.upcoming.mockResolvedValue([RECORD]);
    maintenance.create.mockResolvedValue(RECORD);
    maintenance.remove.mockResolvedValue(undefined);
  });

  describe('GET /api/maintenance/upcoming', () => {
    it('BR-003-03: is public, answers { items } and exposes only what a visitor needs', async () => {
      // `standard` is not an admin; the public route needs no sign-in at all (@Public, SC-07).
      const response = await request(standard.getHttpServer())
        .get('/api/maintenance/upcoming')
        .expect(200);

      expect(response.body).toEqual({
        items: [
          {
            id: RECORD.id,
            startsAt: '2026-03-10T05:00:00.000Z',
            endsAt: '2026-03-10T07:00:00.000Z',
            message: 'Manutenção programada',
            announcedInTime: true,
          },
        ],
      });
      expect(response.text).not.toContain('createdBy');
      expect(response.text).not.toContain(RECORD.createdBy);
      expect(response.text).not.toContain('announcedAt');
    });

    it('BR-003-03: flags a window announced 47 h ahead as not in time', async () => {
      maintenance.upcoming.mockResolvedValue([
        { ...RECORD, announcedAt: new Date('2026-03-08T06:00:00.000Z') }, // 47 h before the start
      ]);

      const response = await request(standard.getHttpServer())
        .get('/api/maintenance/upcoming')
        .expect(200);

      expect(response.body.items[0].announcedInTime).toBe(false);
    });

    it('answers an empty list when nothing is scheduled', async () => {
      maintenance.upcoming.mockResolvedValue([]);
      const response = await request(standard.getHttpServer())
        .get('/api/maintenance/upcoming')
        .expect(200);
      expect(response.body).toEqual({ items: [] });
    });

    it('lets caches reuse the answer for 30 seconds', async () => {
      const response = await request(standard.getHttpServer()).get('/api/maintenance/upcoming');
      expect(response.headers['cache-control']).toBe('public, max-age=30');
    });
  });

  describe('GET /api/maintenance as an admin', () => {
    itAnswersPages({
      app: () => admin,
      path: '/api/maintenance',
      method: maintenance.findPage,
      pageArg: 0,
      item: RECORD,
      expectedItem: {
        id: RECORD.id,
        startsAt: '2026-03-10T05:00:00.000Z',
        endsAt: '2026-03-10T07:00:00.000Z',
        message: 'Manutenção programada',
        announcedInTime: true,
        announcedAt: '2026-03-07T05:00:00.000Z',
        createdBy: RECORD.createdBy,
        createdAt: '2026-03-07T05:00:00.000Z',
      },
    });
  });

  describe('POST /api/maintenance', () => {
    it('creates a window as the signed-in admin', async () => {
      const response = await request(admin.getHttpServer())
        .post('/api/maintenance')
        .send(BODY)
        .expect(201);

      expect(maintenance.create).toHaveBeenCalledWith(BODY, TEST_USER.userId);
      expect(response.body).toMatchObject({ id: RECORD.id, announcedInTime: true });
    });

    it('is refused for a non-admin before the service is asked', async () => {
      const response = await request(standard.getHttpServer())
        .post('/api/maintenance')
        .send(BODY)
        .expect(403);

      expect(response.body.code).toBe('FORBIDDEN');
      expect(maintenance.create).not.toHaveBeenCalled();
    });

    it('BR-003-03: refuses a client-supplied announcedAt', async () => {
      const response = await request(admin.getHttpServer())
        .post('/api/maintenance')
        .send({ ...BODY, announcedAt: '2020-01-01T00:00:00.000Z' })
        .expect(400);

      expect(response.body).toEqual({
        code: 'VALIDATION_FAILED',
        context: { fields: ['announcedAt'] },
      });
      expect(maintenance.create).not.toHaveBeenCalled();
    });

    it.each([
      ['a bare date as startsAt', { ...BODY, startsAt: '2026-03-10' }, 'startsAt'],
      ['a non-date endsAt', { ...BODY, endsAt: 'amanhã' }, 'endsAt'],
      ['an empty message', { ...BODY, message: '   ' }, 'message'],
      ['a message over 500 characters', { ...BODY, message: 'a'.repeat(501) }, 'message'],
      ['no message', { startsAt: BODY.startsAt, endsAt: BODY.endsAt }, 'message'],
    ])('refuses %s as VALIDATION_FAILED naming the field only', async (_name, body, field) => {
      const response = await request(admin.getHttpServer())
        .post('/api/maintenance')
        .send(body)
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect(response.body.context.fields).toContain(field);
      expect(maintenance.create).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/maintenance/:id', () => {
    it('answers 204 to an admin', async () => {
      await request(admin.getHttpServer()).delete(`/api/maintenance/${RECORD.id}`).expect(204);
      expect(maintenance.remove).toHaveBeenCalledWith(RECORD.id);
    });

    it('answers 409 for a window that started', async () => {
      maintenance.remove.mockRejectedValue(
        new DomainError('MAINTENANCE_WINDOW_ALREADY_STARTED', { id: RECORD.id }),
      );
      const response = await request(admin.getHttpServer())
        .delete(`/api/maintenance/${RECORD.id}`)
        .expect(409);
      expect(response.body.code).toBe('MAINTENANCE_WINDOW_ALREADY_STARTED');
    });

    it('answers 404 for an unknown window', async () => {
      maintenance.remove.mockRejectedValue(new DomainError('MAINTENANCE_WINDOW_NOT_FOUND'));
      await request(admin.getHttpServer()).delete('/api/maintenance/unknown').expect(404);
    });

    it('is refused for a non-admin', async () => {
      await request(standard.getHttpServer()).delete(`/api/maintenance/${RECORD.id}`).expect(403);
      expect(maintenance.remove).not.toHaveBeenCalled();
    });
  });
});
