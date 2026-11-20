// A Nest app for HTTP-level unit specs of a controller (TESTING §2): the controller under test,
// its services stubbed, the app's own setup (configureApp: prefix, validation, error filter,
// OpenAPI) and the two global guards (JwtAuthGuard, AccessContextGuard) replaced by a stand-in
// that signs TEST_USER in and puts the AccessContext the real AccessContextFactory builds for it on
// the request (SPEC-002), from the default sources unless a spec passes its own. supertest binds an
// ephemeral loopback port in the test process; nothing leaves the machine (TS-01, TS-07).
import type { ExecutionContext, INestApplication, ModuleMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { configureApp } from '../../src/app.setup.js';
import { isPublicRoute } from '../../src/auth/decorators/public.decorator.js';
import { APP_GUARD, Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../../src/auth/interfaces/auth.interface.js';
import {
  ACCESS_CONTEXT,
  type RequestWithAccess,
} from '../../src/access/decorators/access.decorator.js';
import {
  accessContextFactory,
  type AccessSources,
  fakeAccessSources,
} from '../fakes/fake-access-sources.js';
import { testConfigService } from './test-env.js';

/** An obviously fake signed-in user (TS-27). */
export const TEST_USER: AuthenticatedUser = {
  userId: '64b7f0000000000000000001',
  sessionId: 'test-session-id',
  email: 'ana.teste@example.test',
  name: 'Ana Teste',
  emailVerified: true,
  providers: ['local'],
  role: 'standard',
  subscriptionStatus: 'active',
  isAdmin: false,
  whatsappPromptPending: false,
};

export interface HttpAppOptions {
  /** Who JwtAuthGuard lets in; defaults to TEST_USER. */
  user?: AuthenticatedUser;
  /** Raw environment overrides, e.g. { NODE_ENV: 'production' }. */
  env?: Record<string, string>;
  /** The SPEC-002 relationships of the user; none by default (fakeAccessSources). */
  access?: AccessSources;
}

export async function createHttpApp(
  metadata: ModuleMetadata,
  { user = TEST_USER, env = {}, access = fakeAccessSources() }: HttpAppOptions = {},
): Promise<INestApplication> {
  const reflector = new Reflector();
  const factory = accessContextFactory(access);
  const moduleRef = await Test.createTestingModule({
    ...metadata,
    providers: [
      ...(metadata.providers ?? []),
      { provide: ConfigService, useValue: testConfigService(env) },
      {
        provide: APP_GUARD,
        useValue: {
          canActivate: async (context: ExecutionContext) => {
            // SC-07: mirror production's opt-out so public controller specs stay anonymous; the
            // same rule as the real guards, so an access requirement overrides @Public().
            if (isPublicRoute(reflector, context)) return true;
            const request = context
              .switchToHttp()
              .getRequest<RequestWithAccess & { user?: AuthenticatedUser }>();
            request.user = user;
            request[ACCESS_CONTEXT] = await factory.forAccount(user);
            return true;
          },
        },
      },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
