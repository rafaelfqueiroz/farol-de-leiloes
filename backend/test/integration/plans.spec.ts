// SPEC-012 BR-012-01..BR-012-05, AR-17, SC-07, TS-02: the plan catalog against a real MongoDB,
// through the real guards: money round-trips as Decimal128, the unique indexes hold, the public
// route answers anonymously with the offered plans only, and editing or withdrawing a plan never
// touches the copy a subscription holds (BR-012-04).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { Decimal } from '../../src/common/money/money.js';
import { PaymentGateway } from '../../src/payments/payment-gateway.js';
import type { PlanDefinition } from '../../src/plans/plan.js';
import { PlansModule } from '../../src/plans/plans.module.js';
import { parsePlanCatalog } from '../../src/plans/upsert/plan-catalog-file.js';
import {
  exitCodeOf,
  PlansUpsertCommand,
  summaryOf,
} from '../../src/plans/upsert/plans-upsert.command.js';
import { PlansService } from '../../src/plans/plans.service.js';
import { PlanEntity, type PlanDocument } from '../../src/plans/schemas/plan.schema.js';
import { OFFICE_PROVISIONER } from '../../src/subscriptions/ports/office-provisioner.js';
import { SubscriptionsRepository } from '../../src/subscriptions/subscriptions.repository.js';
import { SubscriptionsService } from '../../src/subscriptions/subscriptions.service.js';
import { aProviderSubscription } from '../builders/provider-subscription.builder.js';
import { FakeOfficeProvisioner } from '../fakes/fake-office-provisioner.js';
import { FakePaymentGateway } from '../fakes/fake-payment-gateway.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

function definition(overrides: Partial<PlanDefinition> = {}): PlanDefinition {
  return {
    code: 'escritorio-5',
    name: 'Escritório 5',
    price: new Decimal('199.90'),
    interval: 'month',
    activeJourneyLimit: 5,
    stripePriceId: 'price_5',
    status: 'OFFERED',
    sortOrder: 10,
    ...overrides,
  };
}

describe('plan catalog (integration, SPEC-012)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let plans: PlansService;
  let model: Model<PlanDocument>;
  const gateway = new FakePaymentGateway();
  const provisioner = new FakeOfficeProvisioner();

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];
  const raw = (code: string) => model.collection.findOne({ code });

  beforeAll(async () => {
    harness = await createAuthTestApp(db, [PlansModule], {}, (builder) =>
      builder
        .overrideProvider(PaymentGateway)
        .useValue(gateway)
        .overrideProvider(OFFICE_PROVISIONER)
        .useValue(provisioner),
    );
    plans = harness.moduleRef.get(PlansService, { strict: false });
    // The provider holds every price the catalog names (the script checks them, BR-012-02); the
    // specs that need a divergence say so with gateway.listsPlan(..., overrides).
    const upsertCatalog = plans.upsertCatalog.bind(plans);
    plans.upsertCatalog = (definitions) => {
      for (const plan of definitions) {
        if (!gateway.prices.has(plan.stripePriceId)) gateway.listsPlan(plan);
      }
      return upsertCatalog(definitions);
    };
    model = harness.moduleRef.get(getModelToken(PlanEntity.name));
    await model.syncIndexes(); // the unique indexes migration 0006 builds in the deploy
  });

  afterAll(async () => {
    await harness.app.close();
  });

  describe('AR-17: money is Decimal128 in the database, a Decimal in code, a string over JSON', () => {
    it('stores the price as Decimal128 reais and reads it back digit for digit', async () => {
      await plans.upsertCatalog([
        definition({ code: 'cents', stripePriceId: 'price_cents', price: new Decimal('0.10') }),
        definition({ code: 'big', stripePriceId: 'price_big', price: new Decimal('1234567.89') }),
      ]);

      const stored = await raw('cents');
      expect(stored?.price).toMatchObject({ _bsontype: 'Decimal128' });
      // Decimal128 keeps the value, not its trailing zeros: R$ 0,10 is stored as 0.1, exactly.
      expect(String(stored?.price)).toBe('0.1');
      expect((await plans.findByCode('cents'))?.price.equals('0.10')).toBe(true);
      expect((await plans.findByCode('big'))?.price.toFixed()).toBe('1234567.89');
    });
  });

  describe('BR-012-02: the catalog script upserts by code', () => {
    it('creates, then leaves the same catalog unchanged on a second run', async () => {
      const catalog = [definition({ code: 'idem', stripePriceId: 'price_idem' })];

      expect(await plans.upsertCatalog(catalog)).toEqual({
        result: 'applied',
        created: 1,
        updated: 0,
        unchanged: 0,
      });
      const before = await raw('idem');
      expect(await plans.upsertCatalog(catalog)).toEqual({
        result: 'applied',
        created: 0,
        updated: 0,
        unchanged: 1,
      });
      expect(await raw('idem')).toEqual(before); // not even updatedAt moved
    });

    it('changes the limit and the name of a code in place', async () => {
      await plans.upsertCatalog([definition({ code: 'edit', stripePriceId: 'price_edit' })]);

      const outcome = await plans.upsertCatalog([
        definition({
          code: 'edit',
          stripePriceId: 'price_edit',
          name: 'Escritório 9',
          activeJourneyLimit: 9,
        }),
      ]);

      expect(outcome).toMatchObject({ result: 'applied', updated: 1 });
      expect(await plans.findByCode('edit')).toMatchObject({
        name: 'Escritório 9',
        activeJourneyLimit: 9,
      });
    });

    it('BR-012-02: a displayed price the provider does not charge is refused, and the stored plan is left alone', async () => {
      await plans.upsertCatalog([definition({ code: 'shown', stripePriceId: 'price_shown' })]);

      // The provider still charges R$ 199,90 on this price (a provider price is immutable).
      const outcome = await plans.upsertCatalog([
        definition({ code: 'shown', stripePriceId: 'price_shown', price: new Decimal('299.90') }),
      ]);

      expect(outcome).toEqual({ result: 'refused_price_mismatch', conflicts: 1 });
      expect((await plans.findByCode('shown'))?.price.toFixed(2)).toBe('199.90');
    });

    it('refuses a provider price that belongs to another plan, writing nothing', async () => {
      await plans.upsertCatalog([definition({ code: 'owner', stripePriceId: 'price_owner' })]);

      const outcome = await plans.upsertCatalog([
        definition({ code: 'fresh-one', stripePriceId: 'price_fresh_one' }),
        definition({ code: 'thief', stripePriceId: 'price_owner' }),
      ]);

      expect(outcome).toEqual({ result: 'refused_duplicate_price', conflicts: 1 });
      expect(await plans.findByCode('fresh-one')).toBeNull();
      expect(await plans.findByCode('thief')).toBeNull();
    });

    it('refuses to change the provider price of an existing code, writing nothing', async () => {
      await plans.upsertCatalog([definition({ code: 'stable', stripePriceId: 'price_stable' })]);

      const outcome = await plans.upsertCatalog([
        definition({ code: 'stable', stripePriceId: 'price_stable_2', activeJourneyLimit: 99 }),
      ]);

      expect(outcome).toEqual({ result: 'refused_price_changed', conflicts: 1 });
      expect(await plans.findByCode('stable')).toMatchObject({
        stripePriceId: 'price_stable',
        activeJourneyLimit: 5,
      });
    });

    it('the unique indexes are the backstop: a raw second plan with a taken code or price fails', async () => {
      await plans.upsertCatalog([definition({ code: 'unique', stripePriceId: 'price_unique' })]);
      const base = { name: 'X', audience: 'ADVISOR_OFFICE', interval: 'month', status: 'OFFERED' };

      await expect(
        model.collection.insertOne({ ...base, code: 'unique', stripePriceId: 'price_other' }),
      ).rejects.toMatchObject({ code: 11000 });
      await expect(
        model.collection.insertOne({ ...base, code: 'other', stripePriceId: 'price_unique' }),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe('BR-012-02: `npm run plans:upsert` end to end (file → validation → database)', () => {
    const FILE = {
      plans: [
        {
          code: 'file-a',
          name: 'Do arquivo A',
          price: '149.90',
          interval: 'month',
          activeJourneyLimit: 3,
          stripePriceId: 'price_file_a',
        },
        {
          code: 'file-b',
          name: 'Do arquivo B',
          price: '1499.00',
          interval: 'year',
          activeJourneyLimit: 12,
          stripePriceId: 'price_file_b',
          status: 'WITHDRAWN',
          sortOrder: 7,
        },
      ],
    };

    it('writes the validated file, prints only counts, and is idempotent on a second run', async () => {
      const parsed = parsePlanCatalog(FILE);
      if (!parsed.ok) throw new Error(parsed.error);
      const command = new PlansUpsertCommand(plans);

      const first = await command.run(parsed.plans);
      const second = await command.run(parsed.plans);

      expect(summaryOf(first)).toBe('plans:upsert: created 2, updated 0, unchanged 0');
      expect(exitCodeOf(first)).toBe(0);
      expect(summaryOf(second)).toBe('plans:upsert: created 0, updated 0, unchanged 2');
      expect(await plans.findByCode('file-b')).toMatchObject({
        interval: 'year',
        activeJourneyLimit: 12,
        status: 'WITHDRAWN',
        sortOrder: 7,
      });
      expect((await plans.findByCode('file-a'))?.price.toFixed(2)).toBe('149.90');
    });

    it('exits 1 and writes nothing when the file repeats a provider price of another plan', async () => {
      const parsed = parsePlanCatalog({
        plans: [{ ...FILE.plans[0], code: 'file-c', stripePriceId: 'price_file_b' }],
      });
      if (!parsed.ok) throw new Error(parsed.error);

      const outcome = await new PlansUpsertCommand(plans).run(parsed.plans);

      expect(exitCodeOf(outcome)).toBe(1);
      expect(summaryOf(outcome)).toBe(
        'plans:upsert: refused_duplicate_price (1); nothing was written',
      );
      expect(await plans.findByCode('file-c')).toBeNull();
    });
  });

  describe('BR-012-05, SC-07: GET /api/plans', () => {
    it('answers anonymously with the offered plans in order, withdrawn ones left out (BR-012-04)', async () => {
      await model.collection.deleteMany({});
      await plans.upsertCatalog([
        definition({
          code: 'z-last',
          stripePriceId: 'price_z',
          sortOrder: 30,
          price: new Decimal('299.9'),
        }),
        definition({
          code: 'a-first',
          stripePriceId: 'price_a',
          sortOrder: 10,
          activeJourneyLimit: 2,
          price: new Decimal('99'),
        }),
        definition({ code: 'old', stripePriceId: 'price_old', sortOrder: 5, status: 'WITHDRAWN' }),
      ]);

      const response = await request(server()).get('/api/plans').expect(200);

      expect(response.body).toEqual({
        items: [
          {
            code: 'a-first',
            name: 'Escritório 5',
            price: '99.00',
            interval: 'month',
            activeJourneyLimit: 2,
          },
          {
            code: 'z-last',
            name: 'Escritório 5',
            price: '299.90',
            interval: 'month',
            activeJourneyLimit: 5,
          },
        ],
      });
    });

    it('answers an empty list when nothing is offered', async () => {
      await model.collection.deleteMany({});

      await request(server()).get('/api/plans').expect(200, { items: [] });
    });
  });

  describe('BR-012-04: an existing subscription keeps what it copied when the plan changes', () => {
    const BUYER = '64b7f0000000000000000b01';
    const OFFICE = '64b7f0000000000000000c01';

    it('keeps its limit when the catalog raises it, withdraws the plan, and the provider syncs', async () => {
      await model.collection.deleteMany({});
      await plans.upsertCatalog([definition({ code: 'kept', stripePriceId: 'price_kept' })]);
      const plan = await plans.findByCode('kept');
      const subscriptions = harness.moduleRef.get(SubscriptionsRepository, { strict: false });
      const service = harness.moduleRef.get(SubscriptionsService, { strict: false });
      const created = await subscriptions.createPending({
        buyerUserId: BUYER,
        planId: plan?.id ?? '',
        planCode: 'kept',
        activeJourneyLimit: plan?.activeJourneyLimit ?? 0,
        officeId: OFFICE,
      });
      gateway.setSubscription(
        aProviderSubscription({
          id: 'sub_kept',
          priceId: 'price_kept',
          subscriptionRef: created.id,
        }),
      );
      await service.handleProviderEvent({
        id: 'evt_kept_1',
        type: 'subscription.changed',
        subscriptionId: 'sub_kept',
      });
      expect(await subscriptions.findById(created.id)).toMatchObject({
        status: 'ACTIVE',
        activeJourneyLimit: 5,
      });

      // The operator raises the limit to 9 and then withdraws the plan.
      await plans.upsertCatalog([
        definition({ code: 'kept', stripePriceId: 'price_kept', activeJourneyLimit: 9 }),
      ]);
      await plans.upsertCatalog([
        definition({
          code: 'kept',
          stripePriceId: 'price_kept',
          activeJourneyLimit: 9,
          status: 'WITHDRAWN',
        }),
      ]);
      // A later sync from the provider (same price) does not pull the new number onto the office.
      await service.handleProviderEvent({
        id: 'evt_kept_2',
        type: 'subscription.changed',
        subscriptionId: 'sub_kept',
      });

      expect(await subscriptions.findById(created.id)).toMatchObject({
        status: 'ACTIVE',
        planCode: 'kept',
        activeJourneyLimit: 5,
        planId: plan?.id,
      });
      expect(await plans.findByStripePriceId('price_kept')).toMatchObject({
        status: 'WITHDRAWN',
        activeJourneyLimit: 9,
      });
    });
  });
});
