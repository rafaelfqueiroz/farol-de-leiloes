// SPEC-001 BR-001-25, BR-001-27, BR-001-29, BR-001-31 (RNF-13), BR-001-26 / D-63, over HTTP on a
// real MongoDB: PATCH /api/auth/profile accepts a closed list of fields and rejects everything
// else as a whole, leaving the stored account byte-identical.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import {
  SubscriptionEntity,
  type SubscriptionDocument,
} from '../../src/subscriptions/schemas/subscription.schema.js';
import { PaymentsModule } from '../../src/payments/payments.module.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

const PASSWORD = 'correct horse';

describe('PATCH /api/auth/profile allowlist (integration)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let users: Model<UserDocument>;
  let subscriptions: Model<SubscriptionDocument>;
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
    // The payments module is loaded too: its removed user routes must really be gone.
    harness = await createAuthTestApp(db, [PaymentsModule]);
    users = harness.moduleRef.get(getModelToken(UserEntity.name));
    subscriptions = harness.moduleRef.get(getModelToken(SubscriptionEntity.name));
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
    ['isAdmin', true], // SPEC-002 BR-002-21: only the grant-admin script sets it
    ['personas', ['advisor']], // SPEC-002 BR-002-14: derived, never stored
    // SPEC-012 BR-012-14: a plan, a subscription state and a limit belong to an office and follow
    // the provider; no profile request can set any of them.
    ['planCode', 'escritorio-5'],
    ['subscription', { status: 'ACTIVE', activeJourneyLimit: 99 }],
    ['subscriptionId', '64b7f0000000000000000dd1'],
    ['activeJourneyLimit', 99],
    ['journeyLimit', 99],
    ['advisorPlanActive', true],
    ['readOnly', false],
    ['readOnlyAt', '2099-01-01T00:00:00.000Z'],
    ['lapsedAt', '2099-01-01T00:00:00.000Z'],
    ['entitlements', ['advisor']],
    ['officeId', '64b7f0000000000000000c01'],
    ['stripePriceId', 'price_hostile'],
    ['cancelAtPeriodEnd', false],
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

  it.each([
    ['null', null],
    ['a number', 5],
    ['an object', { $ne: null }],
    ['an array', ['a@example.test']],
    ['an empty string', ''],
    ['not an address', 'not-an-address'],
  ])(
    'SC-10, AR-34: an email that is %s is a controlled 400 VALIDATION_FAILED, never a 500, and nothing changes',
    async (_label, email) => {
      const account1 = await account();
      const before = await stored(account1.email);

      const response = await patch(account1.token, { name: 'X', email }).expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(response.body.context.fields).toContain('email');
      expect(await stored(account1.email)).toEqual(before);
    },
  );

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

  it('the legacy complete-profile route is gone and writes nothing', async () => {
    const { email, token } = await account();
    const before = await stored(email);

    await request(server())
      .patch('/api/auth/profile/complete')
      .set('Authorization', `Bearer ${token}`)
      .send({ phone: '(84) 99999-1234', cpf: '00000000000', sex: 'other' })
      .expect(404);

    expect(await stored(email)).toEqual(before);
  });

  it('PATCH /auth/profile refuses cpf, birth date, sex and address (erased, BR-010-06) as a whole', async () => {
    const { email, token } = await account();
    const before = await stored(email);

    for (const legacy of [
      { cpf: '00000000000' },
      { dateOfBirth: '1990-01-01' },
      { sex: 'female' },
      { address: { city: 'Natal' } },
    ]) {
      await patch(token, { name: 'X', ...legacy }).expect(400);
    }

    expect(await stored(email)).toEqual(before);
  });

  it('GET /auth/profile/full returns and the store holds no cpf, date of birth, sex or address (SC-26)', async () => {
    const { email, token } = await account();
    const before = await stored(email);

    const response = await request(server())
      .get('/api/auth/profile/full')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    for (const erased of ['cpf', 'dateOfBirth', 'sex', 'address']) {
      expect(response.body).not.toHaveProperty(erased);
      expect(before).not.toHaveProperty(erased);
    }
    expect(await stored(email)).toEqual(before);
  });

  it('the profile response carries no credential or token field', async () => {
    const { token } = await account();

    const response = await patch(token, { name: 'Ana' }).expect(200);

    for (const secret of ['password', 'status', 'pendingEmail', 'googleId', 'stripeCustomerId']) {
      expect(response.body).not.toHaveProperty(secret);
    }
  });

  // SPEC-012 BR-012-14, acceptance: "a request to any account or profile endpoint that tries to
  // set plan, subscription state or limit is rejected, and the stored values are unchanged". The
  // other account endpoints take closed DTOs too (whitelist + forbidNonWhitelisted, AR-34).
  describe('SPEC-012 BR-012-14: no account endpoint sets a plan, a subscription or a limit', () => {
    const HOSTILE_PLAN_FIELDS = {
      role: 'premium',
      subscriptionStatus: 'active',
      planCode: 'escritorio-5',
      activeJourneyLimit: 99,
      stripeSubscriptionId: 'sub_hostile',
    };

    /** A subscription the provider sync owns, to prove no request touches it. */
    async function seededSubscription() {
      return subscriptions.collection.insertOne({
        buyerUserId: new subscriptions.base.Types.ObjectId(),
        planId: new subscriptions.base.Types.ObjectId(),
        planCode: 'escritorio-2',
        activeJourneyLimit: 2,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      });
    }

    it('registration refuses plan fields and creates no account', async () => {
      const email = 'hostile-register@example.test';

      const response = await request(server())
        .post('/api/auth/register')
        .send({ email, password: PASSWORD, name: 'Ana', acceptTerms: true, ...HOSTILE_PLAN_FIELDS })
        .expect(400);

      expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await stored(email)).toBeNull();
    });

    it.each([
      ['change-password', { currentPassword: PASSWORD, newPassword: 'a brand new password' }],
      ['set-password', { newPassword: 'a brand new password' }],
    ])(
      '%s refuses plan fields; the account and every subscription are unchanged',
      async (route, body) => {
        const { email, token } = await account();
        const before = await stored(email);
        const subscription = await seededSubscription();
        const subscriptionBefore = await subscriptions.collection.findOne({
          _id: subscription.insertedId,
        });
        const countBefore = await subscriptions.countDocuments();

        const response = await request(server())
          .post(`/api/auth/${route}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ ...body, ...HOSTILE_PLAN_FIELDS })
          .expect(400);

        expect(response.body).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(await stored(email)).toEqual(before);
        expect(await subscriptions.countDocuments()).toBe(countBefore);
        expect(await subscriptions.collection.findOne({ _id: subscription.insertedId })).toEqual(
          subscriptionBefore,
        );
      },
    );

    it('a profile request that carries plan fields leaves the account and every subscription untouched', async () => {
      const { email, token } = await account();
      const before = await stored(email);
      const subscription = await seededSubscription();
      const subscriptionBefore = await subscriptions.collection.findOne({
        _id: subscription.insertedId,
      });

      await patch(token, { name: 'Ana Renomeada', ...HOSTILE_PLAN_FIELDS }).expect(400);

      expect(await stored(email)).toEqual(before);
      expect(await subscriptions.collection.findOne({ _id: subscription.insertedId })).toEqual(
        subscriptionBefore,
      );
      expect(before).toMatchObject({ role: 'free', subscriptionStatus: null });
    });

    it('no plan route exists on /api/auth or /api/payments for a user: the webhook is the only way', async () => {
      const { token } = await account();

      for (const [method, path] of [
        ['post', '/api/payments/create-checkout-session'],
        ['get', '/api/payments/subscription-status'],
        ['post', '/api/payments/cancel-subscription'],
        ['post', '/api/auth/subscription'],
        ['patch', '/api/auth/plan'],
      ] as const) {
        const agent = request(server());
        await agent[method](path)
          .set('Authorization', `Bearer ${token}`)
          .send({ planId: 'standard', role: 'premium' })
          .expect(404);
      }
    });
  });
});
