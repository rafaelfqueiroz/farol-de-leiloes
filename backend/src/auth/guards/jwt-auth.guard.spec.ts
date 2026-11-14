// SC-07: exercise the real global guard and JWT strategy, without a database or live providers.
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
import { UsersService } from '../../users/users.service.js';
import { testConfigService } from '../../../test/support/test-env.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';

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
  controllers: [DefaultProtectedController, PublicController],
  providers: [
    ...productionGuards,
    JwtStrategy,
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
      email: 'guard-test@example.test',
      name: 'Guard Test',
    });
  });

  afterAll(async () => app.close());

  it('registers JwtAuthGuard globally in production', () => {
    expect(productionGuards).toContainEqual({ provide: APP_GUARD, useClass: JwtAuthGuard });
  });

  it('denies an undecorated new endpoint without credentials', async () => {
    const response = await request(app.getHttpServer()).get('/api/guard-test/private').expect(401);
    expect(response.body).toEqual({ code: 'UNAUTHENTICATED', context: {} });
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
