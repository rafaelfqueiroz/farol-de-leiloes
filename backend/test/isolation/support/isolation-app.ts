// SPEC-002 TS-15 / TS-16: the harness of the API-level isolation specs. The real AuthModule,
// JwtStrategy, AccessContextGuard and the feature modules under test on the spec's own database
// (createAuthTestApp); only the clock, the mailer, the four access sources and the support request
// source (SPEC-009's seam, `supportRequests`) are fakes (TS-03, TS-06, TS-07). The sources are ONE FakeAccessSources the spec drives per account at runtime
// (`sources.forAccount(id, {...})`), read on every request like the real ones (BR-002-15), so a
// spec seeds offices A and B, members and investors, and changes them between two requests.
//
// Accounts are created through the API: register, then confirm the email with the link the fake
// mailer received (as test/integration/auth-confirmed-email.spec.ts does), so every request goes
// through the production guards, ConfirmedEmailGuard included.
import type { ModuleMetadata } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { CLIENT_LINK_SOURCE } from '../../../src/access/sources/client-link.source.js';
import { MEMBERSHIP_SOURCE } from '../../../src/access/sources/membership.source.js';
import { OFFICE_PLAN_SOURCE } from '../../../src/access/sources/office-plan.source.js';
import { SELF_ADVISED_SOURCE } from '../../../src/access/sources/self-advised.source.js';
import { SUPPORT_REQUEST_SOURCE } from '../../../src/access/sources/support-request.source.js';
import { UserEntity, type UserDocument } from '../../../src/users/schemas/user.schema.js';
import { FakeAccessSources } from '../../fakes/fake-access-sources.js';
import { FakeSupportRequests } from '../../fakes/fake-support-requests.js';
import { createAuthTestApp, type AuthTestApp } from '../../support/auth-test-app.js';
import type { TestDatabase } from '../../support/test-database.js';

const PASSWORD = 'correct horse battery';

export interface TestAccount {
  readonly id: string;
  readonly email: string;
  readonly token: string;
}

/** The answer of one request, as a client sees it: what BR-002-12 compares. */
export interface Answer {
  readonly status: number;
  readonly body: unknown;
}

export interface IsolationApp {
  readonly harness: AuthTestApp;
  readonly sources: FakeAccessSources;
  /** SPEC-009's support requests, as the grant service reads them (BR-002-24, BR-002-26). */
  readonly supportRequests: FakeSupportRequests;
  /** A new account with a confirmed email, signed in (named `name`, default 'Conta Teste'). */
  signUp(label: string, name?: string): Promise<TestAccount>;
  /** One account per label, in order. */
  signUpAll<const L extends readonly string[]>(
    ...labels: L
  ): Promise<{ -readonly [K in keyof L]: TestAccount }>;
  /** Gives the account the admin capability (only grant-admin does this in production). */
  makeAdmin(account: TestAccount): Promise<void>;
  /** supertest bound to the app, with `account` signed in. */
  as(account: TestAccount): AuthedAgent;
  close(): Promise<void>;
}

type Method = 'get' | 'post' | 'patch' | 'delete';
export type AuthedAgent = Record<Method, (path: string) => request.Test>;

export async function createIsolationApp(
  db: TestDatabase,
  imports: NonNullable<ModuleMetadata['imports']>,
  env: Record<string, string> = {},
): Promise<IsolationApp> {
  const sources = new FakeAccessSources();
  const supportRequests = new FakeSupportRequests();
  const harness = await createAuthTestApp(
    db,
    imports,
    { IMPORT_ENABLED: 'false', SCRAPER_ENABLED: 'false', REMINDERS_ENABLED: 'false', ...env },
    (builder) =>
      builder
        .overrideProvider(MEMBERSHIP_SOURCE)
        .useValue(sources)
        .overrideProvider(CLIENT_LINK_SOURCE)
        .useValue(sources)
        .overrideProvider(SELF_ADVISED_SOURCE)
        .useValue(sources)
        .overrideProvider(OFFICE_PLAN_SOURCE)
        .useValue(sources)
        .overrideProvider(SUPPORT_REQUEST_SOURCE)
        .useValue(supportRequests),
  );
  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];
  const users = harness.moduleRef.get<Model<UserDocument>>(getModelToken(UserEntity.name));
  let counter = 0;

  const signUp = async (label: string, name = 'Conta Teste'): Promise<TestAccount> => {
    counter += 1;
    const email = `${label}-${counter}@example.test`;
    const registered = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name, acceptTerms: true })
      .expect(201);
    const confirmation = harness.mailbox.verificationEmails.find((sent) => sent.email === email);
    await request(server())
      .post('/api/auth/verify-email')
      .send({ token: confirmation?.token ?? '' })
      .expect(200);
    return {
      id: registered.body.user._id as string,
      email,
      token: registered.body.accessToken as string,
    };
  };

  return {
    harness,
    sources,
    supportRequests,
    signUp,
    async signUpAll(...labels) {
      const accounts: TestAccount[] = [];
      for (const label of labels) accounts.push(await signUp(label));
      return accounts as never;
    },
    async makeAdmin(account) {
      await users.updateOne({ email: account.email }, { $set: { isAdmin: true } });
    },
    as(account) {
      const authed =
        (method: Method) =>
        (path: string): request.Test =>
          request(server())[method](path).set('Authorization', `Bearer ${account.token}`);
      return {
        get: authed('get'),
        post: authed('post'),
        patch: authed('patch'),
        delete: authed('delete'),
      };
    },
    async close() {
      await harness.app.close();
    },
  };
}

/** Status and body, so two answers can be compared whole (BR-002-12). */
export async function answerOf(call: request.Test): Promise<Answer> {
  const response = await call;
  return { status: response.status, body: response.body as unknown };
}

/** An id no record has: what a "nonexistent" request asks for (BR-002-12). */
export const RANDOM_ID = '64b7f00000000000000ffff1';
