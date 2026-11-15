// Integration: the maintenance endpoints (SPEC-003 BR-003-03) against a real MongoDB
// (Testcontainers, TESTING §2), through the app's own HTTP setup (configureApp), the production
// JwtAuthGuard (SC-07) and a fake clock (AR-24, TS-06). Only the JWT strategy is a stand-in: it
// accepts tokens signed with the spec's own secret, so the real guard's @Public handling and the
// real RolesGuard decide who gets in. supertest binds an ephemeral loopback port (TS-01, TS-07).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Injectable, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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
import { Clock } from '../../src/common/clock/clock.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { MaintenanceModule } from '../../src/maintenance/maintenance.module.js';
import {
  MaintenanceWindowEntity,
  type MaintenanceWindowDocument,
} from '../../src/maintenance/schemas/maintenance-window.schema.js';
import { DAY, FakeClock, HOUR } from '../fakes/fake-clock.js';
import { testConfigService } from '../support/test-env.js';
import { useTestDatabase } from '../support/test-database.js';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const SECRET = 'maintenance-spec-secret-not-a-real-one';
const ADMIN_ID = '64b7f0000000000000000001';
const STANDARD_ID = '64b7f0000000000000000002';

@Injectable()
class SpecJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: SECRET,
    });
  }

  validate(payload: { sub: string; role: string }) {
    return { userId: payload.sub, role: payload.role };
  }
}

describe('maintenance windows (integration, SPEC-003 BR-003-03)', () => {
  const db = useTestDatabase();
  const clock = new FakeClock(NOW);
  let app: INestApplication;
  let windows: Model<MaintenanceWindowDocument>;
  let adminToken: string;
  let standardToken: string;

  beforeAll(async () => {
    applyMongooseDefaults(); // as in production (SC-10)
    const moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        JwtModule.register({ secret: SECRET }),
        MaintenanceModule,
      ],
      providers: [
        SpecJwtStrategy,
        { provide: APP_GUARD, useClass: JwtAuthGuard },
        { provide: ConfigService, useValue: testConfigService() },
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    windows = moduleRef.get(getModelToken(MaintenanceWindowEntity.name));
    await windows.init(); // the startsAt index is built before the first query
    const jwt = moduleRef.get(JwtService);
    adminToken = jwt.sign({ sub: ADMIN_ID, role: 'admin' });
    standardToken = jwt.sign({ sub: STANDARD_ID, role: 'standard' });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await windows.deleteMany({});
    // The service reuses the public list for 30 s of clock time (TS-05: no test depends on
    // another's data). Reading at a later instant and then returning to NOW makes the cached
    // read "from the future", which the service treats as a miss.
    clock.set(new Date(NOW.getTime() + DAY));
    await request(app.getHttpServer()).get('/api/maintenance/upcoming');
    clock.set(NOW);
  });

  const http = () => request(app.getHttpServer());
  const asAdmin = (req: request.Test) => req.set('Authorization', `Bearer ${adminToken}`);
  const hoursFromNow = (hours: number) => new Date(NOW.getTime() + hours * HOUR).toISOString();
  const aWindow = (
    startsInHours: number,
    durationHours = 2,
    message = 'Manutenção programada',
  ) => ({
    startsAt: hoursFromNow(startsInHours),
    endsAt: hoursFromNow(startsInHours + durationHours),
    message,
  });
  const announce = (body: object) => asAdmin(http().post('/api/maintenance')).send(body);

  describe('POST /api/maintenance', () => {
    it('BR-003-03: announced 48 h ahead is in time, with announcedAt from the server clock', async () => {
      const response = await announce(aWindow(48)).expect(201);

      expect(response.body).toMatchObject({
        startsAt: hoursFromNow(48),
        endsAt: hoursFromNow(50),
        message: 'Manutenção programada',
        announcedInTime: true,
        announcedAt: NOW.toISOString(),
        createdBy: ADMIN_ID,
      });
      const stored = await windows.findById(response.body.id).lean();
      expect(stored?.announcedAt).toEqual(NOW);
      expect(String(stored?.createdBy)).toBe(ADMIN_ID);
    });

    it('BR-003-03: announced 47 h ahead is accepted but not in time (DL-003-03)', async () => {
      const response = await announce(aWindow(47)).expect(201);
      expect(response.body.announcedInTime).toBe(false);
    });

    it('BR-003-03: the notice is measured from the Clock at creation, not from the request', async () => {
      clock.advance(DAY); // now NOW + 24 h; the window starts NOW + 72 h: 48 h of notice
      const inTime = await announce(aWindow(72)).expect(201);
      expect(inTime.body.announcedAt).toBe(new Date(NOW.getTime() + DAY).toISOString());
      expect(inTime.body.announcedInTime).toBe(true);

      clock.advance(HOUR); // now NOW + 25 h: the same start has 47 h of notice
      const late = await announce(aWindow(72)).expect(201);
      expect(late.body.announcedInTime).toBe(false);
    });

    it('BR-003-03: refuses a client-supplied announcedAt and stores nothing', async () => {
      const response = await announce({ ...aWindow(72), announcedAt: hoursFromNow(-100) }).expect(
        400,
      );
      expect(response.body).toEqual({
        code: 'VALIDATION_FAILED',
        context: { fields: ['announcedAt'] },
      });
      expect(await windows.countDocuments()).toBe(0);
    });

    it('reads an offset-less date-time as Brasília time (AR-23)', async () => {
      const response = await announce({
        startsAt: '2026-03-10T02:00',
        endsAt: '2026-03-10T04:00',
        message: 'Manutenção programada',
      }).expect(201);
      expect(response.body.startsAt).toBe('2026-03-10T05:00:00.000Z'); // UTC-3
    });

    it('refuses a start in the past and an end before the start', async () => {
      const past = await announce(aWindow(-1)).expect(400);
      expect(past.body.context.fields).toEqual(['startsAt']);

      const reversed = await announce({ ...aWindow(72), endsAt: hoursFromNow(71) }).expect(400);
      expect(reversed.body.context.fields).toEqual(['endsAt']);
      expect(await windows.countDocuments()).toBe(0);
    });

    it('refuses an empty or over-long message', async () => {
      await announce(aWindow(72, 2, '   ')).expect(400);
      await announce(aWindow(72, 2, 'a'.repeat(501))).expect(400);
      expect(await windows.countDocuments()).toBe(0);
    });

    it('is admin-only: 401 without a token, 403 for a signed-in non-admin', async () => {
      await http().post('/api/maintenance').send(aWindow(72)).expect(401);
      const response = await http()
        .post('/api/maintenance')
        .set('Authorization', `Bearer ${standardToken}`)
        .send(aWindow(72))
        .expect(403);
      expect(response.body.code).toBe('PLAN_NOT_ALLOWED');
      expect(await windows.countDocuments()).toBe(0);
    });
  });

  describe('GET /api/maintenance/upcoming (public)', () => {
    it('lists windows in progress or within 14 days, soonest first, anonymously', async () => {
      await windows.create([
        // The window 13 days away, one in progress, one in 15 days (out), one finished (out).
        row(24 * 13, 2, 'em 13 dias'),
        row(-1, 3, 'em andamento'), // 11:00Z-14:00Z
        row(24 * 15, 2, 'em 15 dias'),
        row(-5, 2, 'terminou'), // ended 09:00Z
        row(72, 2, 'em 3 dias'),
      ]);

      const response = await http().get('/api/maintenance/upcoming').expect(200);

      expect(response.body.items.map((item: { message: string }) => item.message)).toEqual([
        'em andamento',
        'em 3 dias',
        'em 13 dias',
      ]);
    });

    it('answers exactly the public fields: no createdBy, no announcedAt, no timestamps', async () => {
      await windows.create(row(72, 2, 'aviso'));

      const response = await http().get('/api/maintenance/upcoming').expect(200);

      expect(response.body.items).toEqual([
        {
          id: expect.stringMatching(/^[0-9a-f]{24}$/),
          startsAt: hoursFromNow(72),
          endsAt: hoursFromNow(74),
          message: 'aviso',
          announcedInTime: true,
        },
      ]);
      expect(response.text).not.toContain(ADMIN_ID);
      expect(response.text).not.toContain('createdBy');
    });

    it('BR-003-03: announcedInTime is false for a window announced 47 h ahead', async () => {
      await announce(aWindow(47)).expect(201);
      const response = await http().get('/api/maintenance/upcoming').expect(200);
      expect(response.body.items[0].announcedInTime).toBe(false);
    });

    it('shows a window created through the API at once, despite the cache', async () => {
      expect((await http().get('/api/maintenance/upcoming').expect(200)).body.items).toEqual([]);
      await announce(aWindow(72)).expect(201);
      expect((await http().get('/api/maintenance/upcoming').expect(200)).body.items).toHaveLength(
        1,
      );
    });

    it('answers an empty list when nothing is scheduled', async () => {
      const response = await http().get('/api/maintenance/upcoming').expect(200);
      expect(response.body).toEqual({ items: [] });
    });
  });

  describe('GET /api/maintenance (admin)', () => {
    it('lists every window, newest start first, with the admin fields', async () => {
      await windows.create([row(72, 2, 'primeiro'), row(120, 2, 'segundo'), row(-5, 2, 'antigo')]);

      const response = await asAdmin(http().get('/api/maintenance')).expect(200);

      expect(response.body.total).toBe(3);
      expect(response.body.items.map((item: { message: string }) => item.message)).toEqual([
        'segundo',
        'primeiro',
        'antigo',
      ]);
      expect(response.body.items[0]).toMatchObject({ createdBy: ADMIN_ID });
    });

    it('is admin-only', async () => {
      await http().get('/api/maintenance').expect(401);
      await http()
        .get('/api/maintenance')
        .set('Authorization', `Bearer ${standardToken}`)
        .expect(403);
    });
  });

  describe('DELETE /api/maintenance/:id', () => {
    it('removes a window that has not started', async () => {
      const created = await announce(aWindow(72)).expect(201);

      await asAdmin(http().delete(`/api/maintenance/${created.body.id}`)).expect(204);

      expect(await windows.countDocuments()).toBe(0);
      expect((await http().get('/api/maintenance/upcoming')).body.items).toEqual([]);
    });

    it('keeps a window that started: 409, and it stays in the record', async () => {
      const [started] = await windows.create([row(-1, 3, 'em andamento')]);

      const response = await asAdmin(http().delete(`/api/maintenance/${started?.id}`)).expect(409);

      expect(response.body).toEqual({
        code: 'MAINTENANCE_WINDOW_ALREADY_STARTED',
        context: { id: started?.id },
      });
      expect(await windows.countDocuments()).toBe(1);
    });

    it('answers 404 for an unknown or malformed id', async () => {
      await asAdmin(http().delete('/api/maintenance/64b7f00000000000000000ff')).expect(404);
      await asAdmin(http().delete('/api/maintenance/not-an-id')).expect(404);
    });

    it('is admin-only', async () => {
      const [window] = await windows.create([row(72, 2, 'aviso')]);
      await http().delete(`/api/maintenance/${window?.id}`).expect(401);
      await http()
        .delete(`/api/maintenance/${window?.id}`)
        .set('Authorization', `Bearer ${standardToken}`)
        .expect(403);
      expect(await windows.countDocuments()).toBe(1);
    });
  });

  it('AR-27: startsAt is indexed', async () => {
    const indexes = await windows.collection.indexes();
    expect(indexes.map((index) => index.key)).toContainEqual({ startsAt: 1 });
  });

  /** A stored window starting `startsInHours` from NOW, announced a week before. */
  function row(startsInHours: number, durationHours: number, message: string) {
    return {
      startsAt: new Date(NOW.getTime() + startsInHours * HOUR),
      endsAt: new Date(NOW.getTime() + (startsInHours + durationHours) * HOUR),
      message,
      announcedAt: new Date(NOW.getTime() - 7 * DAY),
      createdBy: ADMIN_ID,
    };
  }
});
