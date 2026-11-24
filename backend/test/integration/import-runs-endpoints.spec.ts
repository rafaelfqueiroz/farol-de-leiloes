// SPEC-004 BR-004-24, BR-004-27, BR-004-28: the Import Run endpoints against a real MongoDB
// (Testcontainers), through the app's own HTTP setup (configureApp) and the production guards
// (JwtAuthGuard, AccessContextGuard, AdminGuard), as the maintenance spec does: only the JWT
// strategy is a stand-in. `GET /api/admin/import-runs` is admin-only (401 / 403 / 200); `GET
// /api/auctions/last-update` is public and does not move after a run that only ended.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Injectable, type INestApplication } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { PassportStrategy } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Model } from 'mongoose';
import request from 'supertest';
import { configureApp } from '../../src/app.setup.js';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard.js';
import { AccessModule } from '../../src/access/access.module.js';
import { AccessContextGuard } from '../../src/access/guards/access-context.guard.js';
import { AuctionsController } from '../../src/auctions/auctions.controller.js';
import { AuctionsService } from '../../src/auctions/auctions.service.js';
import { ImportRunsController } from '../../src/auctions/import-runs/import-runs.controller.js';
import {
  ImportRunEntity,
  ImportRunSchema,
  type ImportRunDocument,
} from '../../src/auctions/import-runs/import-run.schema.js';
import { ImportRunRepository } from '../../src/auctions/import-runs/import-run.repository.js';
import { ImportRunService } from '../../src/auctions/import-runs/import-run.service.js';
import { Clock } from '../../src/common/clock/clock.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { FakeClock, HOUR } from '../fakes/fake-clock.js';
import { testConfigService, testEnv } from '../support/test-env.js';
import { useTestDatabase } from '../support/test-database.js';

const NOW = new Date('2026-11-23T15:00:00.000Z');
const SECRET = 'import-runs-spec-secret-not-a-real-one';
const ADMIN_ID = '64b7f0000000000000000001';
const STANDARD_ID = '64b7f0000000000000000002';

@Injectable()
class SpecJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({ jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(), secretOrKey: SECRET });
  }

  validate(payload: { sub: string; isAdmin: boolean }) {
    return { userId: payload.sub, isAdmin: payload.isAdmin, emailVerified: true };
  }
}

describe('the Import Run endpoints (integration, SPEC-004 BR-004-24, BR-004-28)', () => {
  const db = useTestDatabase();
  const clock = new FakeClock(NOW);
  const auctions = { findByCode: vi.fn() };
  let app: INestApplication;
  let runs: Model<ImportRunDocument>;
  let service: ImportRunService;
  let adminToken: string;
  let standardToken: string;

  beforeAll(async () => {
    applyMongooseDefaults(); // as in production (SC-10)
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: () => testEnv() }),
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([{ name: ImportRunEntity.name, schema: ImportRunSchema }]),
        JwtModule.register({ secret: SECRET }),
        AccessModule,
      ],
      controllers: [ImportRunsController, AuctionsController],
      providers: [
        ImportRunService,
        ImportRunRepository,
        { provide: Clock, useValue: clock },
        { provide: AuctionsService, useValue: auctions },
        SpecJwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: APP_GUARD, useClass: AccessContextGuard },
        { provide: ConfigService, useValue: testConfigService() },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    runs = moduleRef.get(getModelToken(ImportRunEntity.name));
    await runs.syncIndexes();
    service = moduleRef.get(ImportRunService);
    const jwt = moduleRef.get(JwtService);
    adminToken = jwt.sign({ sub: ADMIN_ID, isAdmin: true });
    standardToken = jwt.sign({ sub: STANDARD_ID, isAdmin: false });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await runs.deleteMany({});
    clock.set(NOW);
  });

  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken}`);

  /** A run of `day` that ended as `outcome`, its update completed when it is SUCCESS. */
  async function aRun(
    day: string,
    outcome: 'SUCCESS' | 'FAILED' | 'REJECTED_LIST' | 'NO_NEW_LIST' | 'NO_UPDATE',
    complete = outcome === 'SUCCESS',
  ) {
    const run = await service.ensure(day);
    await service.acquireLease(run.id, 'w');
    if (outcome === 'SUCCESS') {
      await service.markSuccess(run.id, 'w', { new: 3, changed: 2, unavailable: 1, active: 40 });
      await service.saveCollection(run.id, 'w', { collected: 5, failed: 1, blocked: true });
      if (complete) await service.completeUpdate(run.id);
    } else {
      await service.finalize(run.id, 'w', {
        outcome,
        reason: outcome === 'NO_UPDATE' ? 'NO_NEW_LIST' : `${outcome}_CODE`,
        nonBusinessReason: outcome === 'NO_UPDATE' ? 'HOLIDAY' : null,
      });
    }
    await service.releaseLease(run.id, 'w');
  }

  describe('GET /api/admin/import-runs (BR-004-28)', () => {
    it('is admin-only: 401 without a token, 403 for a signed-in non-admin, 200 for an admin', async () => {
      await http().get('/api/admin/import-runs').expect(401);
      await http()
        .get('/api/admin/import-runs')
        .set('Authorization', `Bearer ${standardToken}`)
        .expect(403);
      await asAdmin(http().get('/api/admin/import-runs')).expect(200);
    });

    it('answers the BR-004-27 fields, newest first, paginated, with codes and no personal data', async () => {
      await aRun('2026-11-20', 'SUCCESS');
      clock.advance(HOUR);
      await aRun('2026-11-21', 'NO_UPDATE');
      await aRun('2026-11-23', 'REJECTED_LIST');

      const response = await asAdmin(http().get('/api/admin/import-runs')).expect(200);

      expect(response.body).toMatchObject({ total: 3, page: 1, pageSize: 20 });
      expect(
        response.body.items.map((item: { brasiliaDate: string }) => item.brasiliaDate),
      ).toEqual(['2026-11-23', '2026-11-21', '2026-11-20']);
      const [rejected, noUpdate, success] = response.body.items;
      expect(rejected).toMatchObject({
        outcome: 'REJECTED_LIST',
        failureReasons: ['REJECTED_LIST_CODE'],
        nonBusinessReason: null,
        endedAt: new Date(NOW.getTime() + HOUR).toISOString(),
        blocked: false,
      });
      expect(noUpdate).toMatchObject({ outcome: 'NO_UPDATE', nonBusinessReason: 'HOLIDAY' });
      expect(success).toEqual({
        brasiliaDate: '2026-11-20',
        startedAt: NOW.toISOString(),
        endedAt: NOW.toISOString(),
        outcome: 'SUCCESS',
        listGeneratedOn: null,
        rowCount: 0,
        attempts: 0,
        newCount: 3,
        changedCount: 2,
        unavailableCount: 1,
        activeCount: 40,
        detailsCollected: 5,
        detailsFailed: 1,
        blocked: true,
        failureReasons: [],
        nonBusinessReason: null,
      });
      // The row's internals never leave: no id, no lease, no alert bookkeeping.
      expect(Object.keys(success)).not.toEqual(
        expect.arrayContaining(['_id', 'id', 'leaseOwner', 'alertedAt', 'updateCompletedAt']),
      );
    });

    it('AR-35: pages of `pageSize`, and refuses a pageSize outside 1..100', async () => {
      for (const day of ['2026-11-18', '2026-11-19', '2026-11-20']) await aRun(day, 'FAILED');

      const page = await asAdmin(http().get('/api/admin/import-runs?page=2&pageSize=2')).expect(
        200,
      );
      expect(page.body).toMatchObject({ total: 3, page: 2, pageSize: 2 });
      expect(page.body.items.map((item: { brasiliaDate: string }) => item.brasiliaDate)).toEqual([
        '2026-11-18',
      ]);

      const refused = await asAdmin(http().get('/api/admin/import-runs?pageSize=101')).expect(400);
      expect(refused.body.code).toBe('VALIDATION_FAILED');
    });

    it('an empty history is an empty page', async () => {
      const response = await asAdmin(http().get('/api/admin/import-runs')).expect(200);
      expect(response.body).toEqual({ items: [], total: 0, page: 1, pageSize: 20 });
    });
  });

  describe('GET /api/auctions/last-update (BR-004-24)', () => {
    it('is public and null before any update completed', async () => {
      const response = await http().get('/api/auctions/last-update').expect(200);
      expect(response.body).toEqual({ finishedAt: null });
    });

    it('moves to a completed update and does NOT move after a failed, rejected, no-new or no-update run', async () => {
      await aRun('2026-11-20', 'SUCCESS');
      const completedAt = NOW.toISOString();
      expect((await http().get('/api/auctions/last-update').expect(200)).body).toEqual({
        finishedAt: completedAt,
      });

      clock.advance(24 * HOUR);
      for (const [day, outcome] of [
        ['2026-11-21', 'NO_UPDATE'],
        ['2026-11-22', 'FAILED'],
        ['2026-11-23', 'REJECTED_LIST'],
        ['2026-11-24', 'NO_NEW_LIST'],
      ] as const) {
        await aRun(day, outcome);
        const response = await http().get('/api/auctions/last-update').expect(200);
        expect(response.body).toEqual({ finishedAt: completedAt });
      }
    });

    it('an applied run whose update is not complete yet does not count', async () => {
      await aRun('2026-11-20', 'SUCCESS', false);

      expect((await http().get('/api/auctions/last-update').expect(200)).body).toEqual({
        finishedAt: null,
      });
    });

    it('is not read as a property code', async () => {
      await http().get('/api/auctions/last-update').expect(200);
      expect(auctions.findByCode).not.toHaveBeenCalled();
    });
  });
});
