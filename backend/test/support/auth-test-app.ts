// A real Nest app for HTTP-level integration specs of the account features (TESTING §2): the real
// AuthModule, UsersModule and Mongoose models on the spec's own database, with only the clock and
// the mailer replaced by fakes (TS-06, TS-07). The fake clock starts in 2099 because MongoDB's TTL
// monitor deletes documents whose `expiresAt` is in the past of the real clock.
import type { INestApplication, ModuleMetadata } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule, type TestingModuleBuilder } from '@nestjs/testing';
import { configureApp } from '../../src/app.setup.js';
import { AuthModule } from '../../src/auth/auth.module.js';
import { Clock } from '../../src/common/clock/clock.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { EmailService } from '../../src/email/email.service.js';
import { FakeClock } from '../fakes/fake-clock.js';
import { FakeEmailSender } from '../fakes/fake-email-sender.js';
import type { TestDatabase } from './test-database.js';
import { testEnv } from './test-env.js';

export const AUTH_TEST_START = new Date('2099-01-15T12:00:00.000Z');

export interface AuthTestApp {
  app: INestApplication;
  moduleRef: TestingModule;
  clock: FakeClock;
  mailbox: FakeEmailSender;
}

export async function createAuthTestApp(
  db: TestDatabase,
  extraImports: NonNullable<ModuleMetadata['imports']> = [],
  env: Record<string, string> = {},
  /** Replaces more providers or guards (e.g. the Google guard, the boundary with Google; TS-07). */
  customize: (builder: TestingModuleBuilder) => TestingModuleBuilder = (builder) => builder,
  /** Runs on the app after configureApp, before it starts (e.g. installing the pino logger). */
  prepareApp: (app: INestApplication) => void = () => undefined,
): Promise<AuthTestApp> {
  applyMongooseDefaults();
  const clock = new FakeClock(AUTH_TEST_START);
  const mailbox = new FakeEmailSender();
  const builder = Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        // One proxy hop: a test chooses its origin with X-Forwarded-For (SC-04).
        validate: () => testEnv({ TRUST_PROXY_HOPS: '1', ...env }),
      }),
      MongooseModule.forRoot(db.uri),
      AuthModule,
      ...extraImports,
    ],
  })
    .overrideProvider(Clock)
    .useValue(clock)
    .overrideProvider(EmailService)
    .useValue(mailbox);
  const moduleRef = await customize(builder).compile();
  const app = moduleRef.createNestApplication();
  configureApp(app);
  prepareApp(app);
  // Listening once (loopback, ephemeral port) keeps supertest from adding listeners to the server
  // on every one of many parallel requests.
  await app.listen(0, '127.0.0.1');
  return { app, moduleRef, clock, mailbox };
}
