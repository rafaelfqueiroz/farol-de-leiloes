// A Nest app for HTTP-level unit specs of a controller (TESTING §2): the controller under test,
// its services stubbed, the app's own setup (configureApp: prefix, validation, error filter,
// OpenAPI) and JwtAuthGuard replaced by a stand-in that signs TEST_USER in. supertest binds an
// ephemeral loopback port in the test process; nothing leaves the machine (TS-01, TS-07).
import type { ExecutionContext, INestApplication, ModuleMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { configureApp } from '../../src/app.setup';
import { JwtAuthGuard } from '../../src/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../src/auth/interfaces/auth.interface';
import { testConfigService } from './test-env';

/** An obviously fake signed-in user (TS-27). */
export const TEST_USER: AuthenticatedUser = {
  userId: '64b7f0000000000000000001',
  email: 'ana.teste@example.test',
  name: 'Ana Teste',
  emailVerified: true,
  providers: ['local'],
  role: 'standard',
  subscriptionStatus: 'active',
};

export interface HttpAppOptions {
  /** Who JwtAuthGuard lets in; defaults to TEST_USER. */
  user?: AuthenticatedUser;
  /** Raw environment overrides, e.g. { NODE_ENV: 'production' }. */
  env?: Record<string, string>;
}

export async function createHttpApp(
  metadata: ModuleMetadata,
  { user = TEST_USER, env = {} }: HttpAppOptions = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    ...metadata,
    providers: [
      ...(metadata.providers ?? []),
      { provide: ConfigService, useValue: testConfigService(env) },
    ],
  })
    .overrideGuard(JwtAuthGuard)
    .useValue({
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>().user = user;
        return true;
      },
    })
    .compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  await app.init();
  return app;
}
