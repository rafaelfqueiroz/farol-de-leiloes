// SPEC-002 BR-002-10: the opt-in access guards over HTTP, with the real AccessContextFactory over
// fake sources (TS-03) building the context the global guard would (test/support/http-app.ts).
import { Controller, Get, type INestApplication, Post, UseGuards } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Public } from '../../auth/decorators/public.decorator.js';
import { createHttpApp, TEST_USER } from '../../../test/support/http-app.js';
import {
  fakeAccessSources,
  type FakeRelationships,
} from '../../../test/fakes/fake-access-sources.js';
import {
  AdminOnly,
  RequiresEntitlement,
  RequiresPersona,
} from '../decorators/access-guards.decorator.js';
import { EntitlementGuard } from './entitlement.guard.js';
import { PersonaGuard } from './persona.guard.js';

@Controller('probe')
class ProbeController {
  @Get('investor-or-advisor')
  @RequiresPersona('investor', 'advisor')
  investorOrAdvisor() {
    return { ok: true };
  }

  @Get('journeys')
  @RequiresEntitlement('journeys')
  readJourneys() {
    return { ok: true };
  }

  @Post('journeys')
  @RequiresEntitlement('journeys', { write: true })
  writeJourneys() {
    return { ok: true };
  }

  @Get('admin')
  @AdminOnly()
  admin() {
    return { ok: true };
  }

  @Get('bare-persona')
  @UseGuards(PersonaGuard)
  barePersona() {
    return { ok: true };
  }

  @Get('bare-entitlement')
  @UseGuards(EntitlementGuard)
  bareEntitlement() {
    return { ok: true };
  }
}

/** SC-07: a class-level access decorator overrides a @Public() handler (isPublicRoute). */
@AdminOnly()
@RequiresPersona('advisor')
@RequiresEntitlement('journeys', { write: true })
@Controller('probe-class')
class ClassLevelController {
  @Public()
  @Get('public')
  open() {
    return { public: true };
  }

  @Get('guarded')
  guarded() {
    return { ok: true };
  }
}

const ACTIVE = { advisorPlanActive: true, readOnly: false, entitlements: ['journeys'] };
const LAPSED = { advisorPlanActive: true, readOnly: true, entitlements: ['journeys'] };

describe('access guards over HTTP (SPEC-002)', () => {
  const apps: INestApplication[] = [];

  async function appFor(relationships: FakeRelationships, user = TEST_USER) {
    const app = await createHttpApp(
      { controllers: [ProbeController, ClassLevelController] },
      { user, access: fakeAccessSources(relationships) },
    );
    apps.push(app);
    return app;
  }

  let searcher: INestApplication;
  let advisor: INestApplication;
  let investor: INestApplication;
  let lapsedAdvisor: INestApplication;
  let admin: INestApplication;

  beforeAll(async () => {
    searcher = await appFor({});
    advisor = await appFor({
      memberships: [{ officeId: 'office-a' }],
      officePlans: { 'office-a': ACTIVE },
    });
    investor = await appFor({ clientLinks: [{ officeId: 'office-a', status: 'active' }] });
    lapsedAdvisor = await appFor({
      memberships: [{ officeId: 'office-a' }],
      officePlans: { 'office-a': LAPSED },
    });
    admin = await appFor(
      { memberships: [{ officeId: 'office-a' }], officePlans: { 'office-a': ACTIVE } },
      { ...TEST_USER, isAdmin: true },
    );
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  describe('@RequiresPersona (BR-002-14)', () => {
    it('lets in an account holding any of the personas', async () => {
      await request(advisor.getHttpServer()).get('/api/probe/investor-or-advisor').expect(200);
      await request(investor.getHttpServer()).get('/api/probe/investor-or-advisor').expect(200);
    });

    it('refuses a searcher with PERSONA_REQUIRED (403, no record involved)', async () => {
      const response = await request(searcher.getHttpServer())
        .get('/api/probe/investor-or-advisor')
        .expect(403);

      expect(response.body).toEqual({
        code: 'PERSONA_REQUIRED',
        context: { personas: ['investor', 'advisor'] },
      });
    });

    it('BR-002-21: refuses an admin even when a source says it is a member', async () => {
      const response = await request(admin.getHttpServer())
        .get('/api/probe/investor-or-advisor')
        .expect(403);

      expect(response.body.code).toBe('PERSONA_REQUIRED');
    });

    it('SC-07: the guard used without its decorator lets nobody through', async () => {
      const response = await request(advisor.getHttpServer())
        .get('/api/probe/bare-persona')
        .expect(403);

      expect(response.body).toEqual({ code: 'FORBIDDEN', context: {} });
    });
  });

  describe('@RequiresEntitlement (BR-002-13, BR-002-30)', () => {
    it('lets an office with the entitlement read and write', async () => {
      await request(advisor.getHttpServer()).get('/api/probe/journeys').expect(200);
      await request(advisor.getHttpServer()).post('/api/probe/journeys').expect(201);
    });

    it('refuses an account without the entitlement with PLAN_NOT_ALLOWED', async () => {
      const response = await request(searcher.getHttpServer())
        .get('/api/probe/journeys')
        .expect(403);

      expect(response.body).toEqual({
        code: 'PLAN_NOT_ALLOWED',
        context: { entitlement: 'journeys' },
      });
    });

    it('BR-002-30: a read-only office still reads', async () => {
      await request(lapsedAdvisor.getHttpServer()).get('/api/probe/journeys').expect(200);
    });

    it('BR-002-30: a read-only office is refused a write with OFFICE_READ_ONLY', async () => {
      const response = await request(lapsedAdvisor.getHttpServer())
        .post('/api/probe/journeys')
        .expect(403);

      expect(response.body).toEqual({
        code: 'OFFICE_READ_ONLY',
        context: { entitlement: 'journeys' },
      });
    });

    it('BR-002-23: an admin has no paid feature, whatever a source returns', async () => {
      const response = await request(admin.getHttpServer()).get('/api/probe/journeys').expect(403);

      expect(response.body.code).toBe('PLAN_NOT_ALLOWED');
    });

    it('SC-07: the guard used without its decorator lets nobody through', async () => {
      await request(advisor.getHttpServer()).get('/api/probe/bare-entitlement').expect(403);
    });
  });

  describe('@AdminOnly (BR-002-23)', () => {
    it('lets in the admin capability', async () => {
      await request(admin.getHttpServer()).get('/api/probe/admin').expect(200);
    });

    it('SC-09: refuses an admin whose email is not confirmed with EMAIL_VERIFICATION_REQUIRED', async () => {
      const unconfirmed = await appFor({}, { ...TEST_USER, isAdmin: true, emailVerified: false });

      const response = await request(unconfirmed.getHttpServer())
        .get('/api/probe/admin')
        .expect(403);

      expect(response.body).toEqual({ code: 'EMAIL_VERIFICATION_REQUIRED', context: {} });
    });

    it('refuses anyone else with FORBIDDEN, including the legacy plan role admin', async () => {
      const legacy = await appFor({}, { ...TEST_USER, role: 'admin', isAdmin: false });

      for (const app of [searcher, advisor, legacy]) {
        const response = await request(app.getHttpServer()).get('/api/probe/admin').expect(403);
        expect(response.body).toEqual({ code: 'FORBIDDEN', context: {} });
      }
    });
  });

  describe('class-level decorators', () => {
    it('SC-07: override a @Public() handler: the requirement still applies', async () => {
      await request(searcher.getHttpServer()).get('/api/probe-class/public').expect(403);
      // An admin advisor of an office with the write entitlement would pass all three, but an admin
      // is never an advisor (BR-002-21), so nobody reaches this probe: it fails closed.
      await request(admin.getHttpServer()).get('/api/probe-class/public').expect(403);
    });

    it('apply to every other handler', async () => {
      await request(searcher.getHttpServer()).get('/api/probe-class/guarded').expect(403);
    });
  });
});
