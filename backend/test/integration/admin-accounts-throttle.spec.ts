// SPEC-009 BR-009-13 (SC-04): the real limit of 30 account searches a minute per admin account, through
// the real app with the throttler ENABLED (it stands down under NODE_ENV=test, so the other specs share
// one account). A separate file: the environment of the first app of a file is the one the process keeps.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { type Connection, type Model } from 'mongoose';
import request from 'supertest';
import { AdminAccessModule } from '../../src/admin-access/admin-access.module.js';
import { AdminAccountsModule } from '../../src/admin-accounts/admin-accounts.module.js';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

const PASSWORD = 'correct horse battery';

describe('the account search limit through the API (SC-04)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let users: Model<UserDocument>;
  let counter = 0;

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];

  async function admin(label: string): Promise<{ Authorization: string }> {
    counter += 1;
    const email = `${label}-${counter}@example.test`;
    const registered = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name: 'Pessoa Ficticia', acceptTerms: true })
      .expect(201);
    const token = harness.mailbox.verificationEmails.find((sent) => sent.email === email)?.token;
    await request(server()).post('/api/auth/verify-email').send({ token }).expect(200);
    await users.updateOne({ email }, { $set: { isAdmin: true } });
    return { Authorization: `Bearer ${registered.body.accessToken as string}` };
  }

  const search = (as: { Authorization: string }) =>
    request(server()).get('/api/admin/accounts?q=abc').set(as);

  beforeAll(async () => {
    harness = await createAuthTestApp(db, [AdminAccountsModule, AdminAccessModule], {
      NODE_ENV: 'development',
      REMINDERS_ENABLED: 'false',
    });
    users = harness.moduleRef.get(getModelToken(UserEntity.name));
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('answers 429 TOO_MANY_REQUESTS to the 31st search of one admin in a minute, and writes no 31st log entry', async () => {
    const as = await admin('limite');
    for (let i = 0; i < 30; i += 1) await search(as).expect(200);

    const refused = await search(as).expect(429);

    expect(refused.body).toEqual({ code: 'TOO_MANY_REQUESTS', context: {} });
    const connection = harness.moduleRef.get<Connection>(getConnectionToken());
    // The refused search was stopped by the guard, before any lookup: 30 entries, not 31.
    expect(
      await connection.db
        ?.collection('adminAccessLogs')
        .countDocuments({ action: 'account_search' }),
    ).toBe(30);
  });

  it('counts admins apart: another admin is not limited by this one, and reading a record is not limited', async () => {
    const other = await admin('outra');

    await search(other).expect(200);
    for (let i = 0; i < 35; i += 1) {
      await request(server())
        .get('/api/admin/accounts/64b7f00000000000000ffff1')
        .set(other)
        .expect(404);
    }
  });
});
