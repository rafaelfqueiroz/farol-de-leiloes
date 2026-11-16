// SPEC-001 BR-001-25, BR-001-27, BR-001-29, BR-001-31 (RNF-13), BR-001-26 / D-63, over HTTP on a
// real MongoDB: PATCH /api/auth/profile accepts a closed list of fields and rejects everything
// else as a whole, leaving the stored account byte-identical.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

const PASSWORD = 'correct horse';

describe('PATCH /api/auth/profile allowlist (integration)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let users: Model<UserDocument>;
  let counter = 0;

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];

  async function account() {
    counter += 1;
    const email = `profile-${counter}@example.test`;
    const response = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name: 'Ana Original', acceptTerms: true })
      .expect(201);
    return { email, token: response.body.accessToken as string };
  }

  const patch = (token: string, body: unknown) =>
    request(server())
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send(body as object);

  /** The stored document exactly as MongoDB holds it. */
  const stored = (email: string) => users.collection.findOne({ email });

  beforeAll(async () => {
    harness = await createAuthTestApp(db);
    users = harness.moduleRef.get(getModelToken(UserEntity.name));
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('BR-001-29, AC: { name, role: "admin" } is refused and changes neither the name nor the role', async () => {
    const { email, token } = await account();
    const before = await stored(email);

    const response = await patch(token, { name: 'X', role: 'admin' }).expect(400);

    expect(response.body).toEqual({ code: 'VALIDATION_FAILED', context: { fields: ['role'] } });
    expect(await stored(email)).toEqual(before);
    expect(before).toMatchObject({ name: 'Ana Original', role: 'free' });
  });

  it.each([
    ['role', 'admin'],
    ['subscriptionStatus', 'active'],
    ['providers', ['google', 'local']],
    ['emailVerified', true],
    ['status', 'closed'],
    ['googleId', 'google-hostile'],
    ['password', 'a hostile password'],
    ['stripeCustomerId', 'cus_hostile'],
    ['stripeSubscriptionId', 'sub_hostile'],
    ['pendingEmail', 'pending@example.test'],
    ['plan', 'premium'],
    ['persona', 'advisor'],
    ['office', 'office-1'],
    ['admin', true],
  ])(
    'BR-001-29: a body with %s is refused as a whole; the stored account is identical',
    async (field, value) => {
      const { email, token } = await account();
      const before = await stored(email);

      const response = await patch(token, { name: 'Ana Renomeada', [field]: value }).expect(400);

      expect(response.body).toEqual({ code: 'VALIDATION_FAILED', context: { fields: [field] } });
      expect(await stored(email)).toEqual(before);
    },
  );

  it('BR-001-26 / D-63: the current email is accepted as a no-op', async () => {
    const { email, token } = await account();
    const before = await stored(email);

    const response = await patch(token, { email: ` ${email.toUpperCase()} ` }).expect(200);

    expect(response.body).toMatchObject({ email, name: 'Ana Original' });
    expect(await stored(email)).toEqual(before);
  });

  it('BR-001-26 / D-63: the form sending the current email with a new name changes only the name', async () => {
    const { email, token } = await account();

    const response = await patch(token, { name: 'Ana Renomeada', email }).expect(200);

    expect(response.body).toMatchObject({ name: 'Ana Renomeada', email });
    expect(await stored(email)).toMatchObject({ name: 'Ana Renomeada', emailVerified: false });
  });

  it('BR-001-26 / D-63: a different email is refused with EMAIL_CHANGE_UNAVAILABLE and nothing changes', async () => {
    const { email, token } = await account();
    const before = await stored(email);

    const response = await patch(token, {
      name: 'Other',
      email: 'someone-else@example.test',
    }).expect(409);

    expect(response.body).toEqual({ code: 'EMAIL_CHANGE_UNAVAILABLE', context: {} });
    expect(await stored(email)).toEqual(before);
    expect(await users.countDocuments({ email: 'someone-else@example.test' })).toBe(0);
  });

  it('BR-001-27, AC: (84) 99999-1234 is accepted and stored as +5584999991234', async () => {
    const { email, token } = await account();

    const response = await patch(token, { phone: '(84) 99999-1234' }).expect(200);

    expect(response.body.phone).toBe('+5584999991234');
    expect(await stored(email)).toMatchObject({ phone: '+5584999991234' });
  });

  it.each(['99999-1234', '(84) 9999-123', 'telefone', '(10) 99999-1234'])(
    'BR-001-27, AC: phone %j is refused and nothing changes',
    async (phone) => {
      const { email, token } = await account();
      const before = await stored(email);

      const response = await patch(token, { name: 'Ana Renomeada', phone }).expect(400);

      expect(response.body).toEqual({ code: 'VALIDATION_FAILED', context: { fields: ['phone'] } });
      expect(await stored(email)).toEqual(before);
    },
  );

  it('BR-001-25: name and phone are updated together; the name is trimmed', async () => {
    const { email, token } = await account();

    const response = await patch(token, { name: '  Ana Nova  ', phone: '+55 84 3222-1234' }).expect(
      200,
    );

    expect(response.body).toMatchObject({ name: 'Ana Nova', phone: '+558432221234' });
    expect(await stored(email)).toMatchObject({ name: 'Ana Nova', phone: '+558432221234' });
  });

  it.each(['', null])('BR-001-27: phone %j removes the phone', async (empty) => {
    const { email, token } = await account();
    await patch(token, { phone: '84999991234' }).expect(200);

    const response = await patch(token, { phone: empty }).expect(200);

    expect(response.body.phone).toBeUndefined();
    expect(await stored(email)).not.toHaveProperty('phone');
  });

  it('refuses a blank name and one longer than 120 characters', async () => {
    const { email, token } = await account();
    const before = await stored(email);

    await patch(token, { name: '   ' }).expect(400);
    await patch(token, { name: 'a'.repeat(121) }).expect(400);

    expect(await stored(email)).toEqual(before);
  });

  it('an empty body changes nothing and answers the profile', async () => {
    const { email, token } = await account();
    const before = await stored(email);

    await patch(token, {}).expect(200);

    expect(await stored(email)).toEqual(before);
  });

  it('BR-001-31: the legacy complete-profile route has its own allowlist and the same phone rule', async () => {
    const { email, token } = await account();
    const complete = (body: object) =>
      request(server())
        .patch('/api/auth/profile/complete')
        .set('Authorization', `Bearer ${token}`)
        .send(body);

    await complete({ role: 'admin' }).expect(400);
    await complete({ phone: '99999-1234' }).expect(400);
    await complete({ phone: '(84) 99999-1234', cpf: '00000000000', sex: 'other' }).expect(200);

    expect(await stored(email)).toMatchObject({
      phone: '+5584999991234',
      cpf: '00000000000',
      sex: 'other',
      role: 'free',
    });
  });

  it('the profile response carries no credential or token field', async () => {
    const { token } = await account();

    const response = await patch(token, { name: 'Ana' }).expect(200);

    for (const secret of ['password', 'status', 'pendingEmail', 'googleId', 'stripeCustomerId']) {
      expect(response.body).not.toHaveProperty(secret);
    }
  });
});
