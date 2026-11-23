// SPEC-009 (decision 6 of #9, SC-04): the real limit of 5 support requests per account per hour, through
// the real app with the throttler ENABLED (it stands down under NODE_ENV=test, so the other specs share
// one account). A separate file: the environment of the first app of a file is the one the process keeps.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { AdminAccessModule } from '../../src/admin-access/admin-access.module.js';
import { SupportModule } from '../../src/support/support.module.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

const PASSWORD = 'correct horse battery';

describe('the support request limit through the API (SC-04)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let counter = 0;

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];

  async function signUp(label: string): Promise<{ Authorization: string }> {
    counter += 1;
    const email = `${label}-${counter}@example.test`;
    const registered = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name: 'Pessoa Ficticia', acceptTerms: true })
      .expect(201);
    const token = harness.mailbox.verificationEmails.find((sent) => sent.email === email)?.token;
    await request(server()).post('/api/auth/verify-email').send({ token }).expect(200);
    return { Authorization: `Bearer ${registered.body.accessToken as string}` };
  }

  const open = (as: { Authorization: string }) =>
    request(server())
      .post('/api/support')
      .set(as)
      .send({ subject: 'Assunto valido', message: 'Mensagem valida de teste.' });

  beforeAll(async () => {
    harness = await createAuthTestApp(db, [SupportModule, AdminAccessModule], {
      NODE_ENV: 'development',
      SUPPORT_MAIL_JOB_ENABLED: 'false',
    });
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('answers 429 TOO_MANY_REQUESTS to the 6th request of one account in the hour, and stores no 6th', async () => {
    const as = await signUp('limite');
    for (let i = 0; i < 5; i += 1) await open(as).expect(201);

    const refused = await open(as).expect(429);

    expect(refused.body).toEqual({ code: 'TOO_MANY_REQUESTS', context: {} });
    const mine = await request(server()).get('/api/support/mine').set(as).expect(200);
    expect((mine.body as { total: number }).total).toBe(5);
  });

  it('counts accounts apart: another account is not limited by this one, and reads are not limited', async () => {
    const other = await signUp('outra');

    await open(other).expect(201);
    for (let i = 0; i < 8; i += 1)
      await request(server()).get('/api/support/mine').set(other).expect(200);
  });
});
