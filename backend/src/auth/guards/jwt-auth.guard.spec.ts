// SC-07: exercise the real global guards (JwtAuthGuard, then SPEC-002's AccessContextGuard) and the
// JWT strategy, without a database or live providers.
import 'reflect-metadata';
import { Controller, Get, type INestApplication, Module, type Provider } from '@nestjs/common';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { configureApp } from '../../app.setup.js';
import { AuthModule } from '../auth.module.js';
import { Public } from '../decorators/public.decorator.js';
import { CurrentUser } from '../decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../interfaces/auth.interface.js';
import { JwtStrategy } from '../strategies/jwt.strategy.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { UsersService } from '../../users/users.service.js';
import { testConfigService } from '../../../test/support/test-env.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { AccessModule } from '../../access/access.module.js';
import type { AccessContext } from '../../access/access-context.js';
import { Access } from '../../access/decorators/access.decorator.js';
import { RequiresPersona } from '../../access/decorators/access-guards.decorator.js';
import { AccessContextGuard } from '../../access/guards/access-context.guard.js';

@Controller('guard-test')
class DefaultProtectedController {
  @Get('private')
  privateRoute(@CurrentUser() user: AuthenticatedUser) {
    return { id: user.userId };
  }

  @Public()
  @Get('public')
  publicRoute() {
    return { public: true };
  }

  // SPEC-002: a persona guard can only pass if the access context was built before it, from the
  // user the JWT guard put on the request: this route proves the order of the global guards.
  @Get('searcher')
  @RequiresPersona('searcher')
  searcherRoute(@Access() access: AccessContext) {
    return { accountId: access.accountId, personas: access.personas };
  }

  @Get('advisor')
  @RequiresPersona('advisor')
  advisorRoute() {
    return { advisor: true };
  }
}

@Public()
@Controller('public-controller-test')
class PublicController {
  @Get()
  publicRoute() {
    return { public: true };
  }
}

// Read the production guard registrations, so removing APP_GUARD from AuthModule fails this
// regression rather than leaving a test-only global guard protecting the test controller.
const productionGuards = (
  Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AuthModule) as Provider[]
).filter((provider) => typeof provider === 'object' && provider.provide === APP_GUARD);

@Module({
  imports: [AccessModule],
  controllers: [DefaultProtectedController, PublicController],
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
        findById: vi.fn().mockResolvedValue({
          emailVerified: true,
          providers: ['local'],
          role: 'free',
          subscriptionStatus: null,
        }),
      },
    },
  ],
})
class GuardTestModule {}

describe('global JWT authentication (SC-07)', () => {
  let app: INestApplication;
  let token: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [GuardTestModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    token = new JwtService({ secret: testConfigService().get('JWT_SECRET') }).sign({
      sub: 'test-user',
      jti: 'test-session',
    });
  });

  afterAll(async () => app.close());

  it('registers JwtAuthGuard globally in production', () => {
    expect(productionGuards).toContainEqual({ provide: APP_GUARD, useClass: JwtAuthGuard });
  });

  it('SPEC-002 AR-13: registers AccessContextGuard immediately after JwtAuthGuard', () => {
    // Global guards of one module run in the order of this array (auth.module.ts).
    expect(productionGuards).toEqual([
      { provide: APP_GUARD, useClass: JwtAuthGuard },
      { provide: APP_GUARD, useClass: AccessContextGuard },
    ]);
  });

  it('SPEC-002: a persona-guarded route sees the context built from the authenticated user', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/guard-test/searcher')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toEqual({ accountId: 'test-user', personas: ['searcher'] });
  });

  it('SPEC-002 BR-002-14: a persona the relationships do not give is refused with 403', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/guard-test/advisor')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
    expect(response.body).toEqual({
      code: 'PERSONA_REQUIRED',
      context: { personas: ['advisor'] },
    });
  });

  it('SPEC-002: a persona-guarded route without credentials is a 401, never a 403', async () => {
    await request(app.getHttpServer()).get('/api/guard-test/searcher').expect(401);
  });

  it('denies an undecorated new endpoint without credentials', async () => {
    const response = await request(app.getHttpServer()).get('/api/guard-test/private').expect(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED', context: {} });
  });

  it('BR-001-17: denies a validly signed token that has no session id', async () => {
    const legacy = new JwtService({ secret: testConfigService().get('JWT_SECRET') }).sign({
      sub: 'test-user',
      email: 'guard-test@example.test',
      name: 'Guard Test',
    });
    await request(app.getHttpServer())
      .get('/api/guard-test/private')
      .set('Authorization', `Bearer ${legacy}`)
      .expect(401);
  });

  it('denies an invalid bearer token', async () => {
    await request(app.getHttpServer())
      .get('/api/guard-test/private')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('authenticates a valid token and exposes its current user to the handler', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/guard-test/private')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(response.body).toEqual({ id: 'test-user' });
  });

  it.each(['/api/guard-test/public', '/api/public-controller-test'])(
    'allows an explicitly public handler or controller: %s',
    async (path) => {
      const response = await request(app.getHttpServer()).get(path).expect(200);
      expect(response.body).toEqual({ public: true });
    },
  );
});
