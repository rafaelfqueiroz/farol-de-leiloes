// SC-07 (SPEC-002 part 1 security review): an access requirement always wins over @Public(). Exercises
// the production global guards (JwtAuthGuard, then AccessContextGuard, read from AuthModule's
// providers), the real JwtStrategy and the real access guards over HTTP; only the users and sessions
// services and the SPEC-011/012 sources are stand-ins (TS-03). Before the fix, a handler-level
// @AdminOnly() inside a @Public() controller let anonymous requests through.
import 'reflect-metadata';
import {
  Controller,
  Get,
  type INestApplication,
  Module,
  type Provider,
  UseGuards,
} from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { configureApp } from '../../app.setup.js';
import { AuthModule } from '../../auth/auth.module.js';
import { Public } from '../../auth/decorators/public.decorator.js';
import { SessionsService } from '../../auth/sessions/sessions.service.js';
import { JwtStrategy } from '../../auth/strategies/jwt.strategy.js';
import { UsersService } from '../../users/users.service.js';
import { testConfigService } from '../../../test/support/test-env.js';
import { AccessModule } from '../access.module.js';
import { SubscriptionsModule } from '../../subscriptions/subscriptions.module.js';
import { StubSubscriptionsModule } from '../../../test/support/stub-subscriptions-module.js';
import {
  AdminOnly,
  RequiresEntitlement,
  RequiresPersona,
} from '../decorators/access-guards.decorator.js';
import { MEMBERSHIP_SOURCE } from '../sources/membership.source.js';
import { OFFICE_PLAN_SOURCE, type OfficePlanState } from '../sources/office-plan.source.js';
import { AdminGuard } from './admin.guard.js';

/** A @Public() controller whose handlers carry access requirements: they must authenticate. */
@Public()
@Controller('public-class')
class PublicClassController {
  @Get('open')
  open() {
    return { public: true };
  }

  @Get('admin')
  @AdminOnly()
  admin() {
    return { ok: true };
  }

  @Get('advisor')
  @RequiresPersona('advisor')
  advisor() {
    return { ok: true };
  }

  @Get('journeys')
  @RequiresEntitlement('journeys')
  journeys() {
    return { ok: true };
  }

  // The guard alone, without its decorator (so without REQUIRES_ACCESS): the global guards treat
  // the route as public, and the access guard still refuses to pass with no context.
  @Get('bare-admin')
  @UseGuards(AdminGuard)
  bareAdmin() {
    return { ok: true };
  }
}

/** A controller-level requirement makes a @Public() handler in it authenticated too. */
@RequiresPersona('advisor')
@Controller('guarded-class')
class GuardedClassController {
  @Public()
  @Get('not-public')
  notPublic() {
    return { ok: true };
  }
}

const ACCOUNTS: Record<string, { isAdmin: boolean; emailVerified: boolean }> = {
  searcher: { isAdmin: false, emailVerified: true },
  advisor: { isAdmin: false, emailVerified: true },
  admin: { isAdmin: true, emailVerified: true },
  'unconfirmed-admin': { isAdmin: true, emailVerified: false },
};

const ACTIVE: OfficePlanState = {
  advisorPlanActive: true,
  readOnly: false,
  entitlements: ['journeys'],
};

const productionGuards = (
  Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuthModule) as Provider[]
).filter((provider) => typeof provider === 'object' && provider.provide === APP_GUARD);

@Module({
  imports: [AccessModule],
  controllers: [PublicClassController, GuardedClassController],
  providers: [
    ...productionGuards,
    JwtStrategy,
    {
      provide: SessionsService,
      useValue: { activeCredentialVersion: vi.fn().mockResolvedValue(0) },
    },
    { provide: ConfigService, useValue: testConfigService() },
    {
      provide: UsersService,
      useValue: {
        findById: vi.fn((id: string) =>
          Promise.resolve(
            ACCOUNTS[id] && {
              ...ACCOUNTS[id],
              providers: ['local'],
              role: 'free',
              status: 'active',
            },
          ),
        ),
      },
    },
  ],
})
class OverrideTestModule {}

describe('SC-07: an access requirement overrides @Public() (SPEC-002)', () => {
  let app: INestApplication;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [OverrideTestModule] })
      // SPEC-012: AccessModule imports the subscriptions module (database, payment gateway); this
      // spec runs the guards only, with the sources overridden below.
      .overrideModule(SubscriptionsModule)
      .useModule(StubSubscriptionsModule)
      .overrideProvider(MEMBERSHIP_SOURCE)
      .useValue({
        activeMemberships: (id: string) =>
          Promise.resolve(id === 'advisor' ? [{ officeId: 'office-a' }] : []),
      })
      .overrideProvider(OFFICE_PLAN_SOURCE)
      .useValue({
        officePlans: (ids: readonly string[]) =>
          Promise.resolve(new Map(ids.map((id) => [id, ACTIVE] as const))),
        selfAdvisedEntitlements: () => Promise.resolve([]),
      })
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    const jwt = new JwtService({ secret: testConfigService().get('JWT_SECRET') });
    for (const id of Object.keys(ACCOUNTS)) {
      tokens[id] = jwt.sign({ sub: id, jti: `session-${id}` });
    }
  });

  afterAll(async () => app.close());

  const get = (path: string, account?: string) => {
    const call = request(app.getHttpServer()).get(`/api${path}`);
    return account ? call.set('Authorization', `Bearer ${tokens[account]}`) : call;
  };

  it('keeps a handler without a requirement in a @Public() controller anonymous', async () => {
    await get('/public-class/open').expect(200);
  });

  describe.each([
    ['@AdminOnly', '/public-class/admin', 'searcher', 'FORBIDDEN', 'admin'],
    ['@RequiresPersona', '/public-class/advisor', 'searcher', 'PERSONA_REQUIRED', 'advisor'],
    ['@RequiresEntitlement', '/public-class/journeys', 'searcher', 'PLAN_NOT_ALLOWED', 'advisor'],
    [
      'a controller-level @RequiresPersona over a @Public() handler',
      '/guarded-class/not-public',
      'searcher',
      'PERSONA_REQUIRED',
      'advisor',
    ],
  ])('%s', (_label, path, refused, code, allowed) => {
    it('answers 401 to an anonymous request', async () => {
      const response = await get(path).expect(401);
      expect(response.body).toEqual({ code: 'UNAUTHENTICATED', context: {} });
    });

    it('answers 403 to a signed-in account without the requirement', async () => {
      const response = await get(path, refused).expect(403);
      expect(response.body.code).toBe(code);
    });

    it('lets in an account that meets it', async () => {
      await get(path, allowed).expect(200);
    });
  });

  it('SC-09: refuses an admin whose email is not confirmed with EMAIL_VERIFICATION_REQUIRED', async () => {
    const response = await get('/public-class/admin', 'unconfirmed-admin').expect(403);
    expect(response.body).toEqual({ code: 'EMAIL_VERIFICATION_REQUIRED', context: {} });
  });

  it('an access guard used bare in a @Public() controller still refuses an anonymous request', async () => {
    const response = await get('/public-class/bare-admin').expect(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED', context: {} });
  });
});
