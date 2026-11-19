// SPEC-012 BR-012-01..BR-012-05: the plan catalog service and the operator upsert, against a
// hand-written fake of the repository (TS-03). The MongoDB behaviour is test/integration/plans.spec.ts.
import { beforeEach, describe, expect, it } from 'vitest';
import { Decimal } from '../common/money/money.js';
import { aPlan } from '../../test/builders/plan.builder.js';
import { aProviderPrice } from '../../test/builders/provider-price.builder.js';
import { FakePaymentGateway } from '../../test/fakes/fake-payment-gateway.js';
import { FakePlansRepository } from '../../test/fakes/fake-plans-repository.js';
import type { ProviderPrice } from '../payments/payment-gateway.js';
import type { PlanDefinition } from './plan.js';
import type { PlansRepository } from './plans.repository.js';
import { PlansService } from './plans.service.js';

function definition(overrides: Partial<PlanDefinition> = {}): PlanDefinition {
  const plan = aPlan();
  return {
    code: plan.code,
    name: plan.name,
    price: plan.price,
    interval: plan.interval,
    activeJourneyLimit: plan.activeJourneyLimit,
    stripePriceId: plan.stripePriceId,
    status: plan.status,
    sortOrder: plan.sortOrder,
    ...overrides,
  };
}

describe('PlansService', () => {
  let repository: FakePlansRepository;
  let gateway: FakePaymentGateway;
  let service: PlansService;

  /** The provider has this definition's price, as the catalog says it (so the check passes). */
  function providerHas(plan: PlanDefinition, overrides: Partial<ProviderPrice> = {}): void {
    gateway.prices.set(
      plan.stripePriceId,
      aProviderPrice({
        id: plan.stripePriceId,
        amount: plan.price,
        interval: plan.interval,
        ...overrides,
      }),
    );
  }

  /** upsertCatalog with the provider holding every price of the definitions. */
  function upsert(definitions: PlanDefinition[]) {
    definitions.forEach((plan) => providerHas(plan));
    return service.upsertCatalog(definitions);
  }

  beforeEach(() => {
    repository = new FakePlansRepository();
    gateway = new FakePaymentGateway();
    service = new PlansService(repository as unknown as PlansRepository, gateway);
  });

  describe('BR-012-04, BR-012-05: what is offered', () => {
    beforeEach(async () => {
      await repository.upsertByCode(
        definition({ code: 'b', stripePriceId: 'price_b', sortOrder: 20 }),
      );
      await repository.upsertByCode(
        definition({ code: 'a', stripePriceId: 'price_a', sortOrder: 10 }),
      );
      await repository.upsertByCode(
        definition({ code: 'old', stripePriceId: 'price_old', sortOrder: 5, status: 'WITHDRAWN' }),
      );
    });

    it('BR-012-05: lists the offered plans in the operator order', async () => {
      expect((await service.listOffered()).map((plan) => plan.code)).toEqual(['a', 'b']);
    });

    it('BR-012-04: a withdrawn plan is not offered but still resolves by code, id and provider price', async () => {
      const withdrawn = await service.findByCode('old');

      expect(withdrawn?.status).toBe('WITHDRAWN');
      expect(await service.findById(withdrawn?.id ?? '')).toEqual(withdrawn);
      expect(await service.findByStripePriceId('price_old')).toEqual(withdrawn);
      expect((await service.listOffered()).map((plan) => plan.code)).not.toContain('old');
    });

    it('answers null for what does not exist', async () => {
      expect(await service.findByCode('nope')).toBeNull();
      expect(await service.findById('64b7f00000000000000000ff')).toBeNull();
      expect(await service.findByStripePriceId('price_nope')).toBeNull();
    });
  });

  describe('BR-012-02: upsertCatalog', () => {
    it('creates new plans and counts them', async () => {
      const outcome = await upsert([
        definition({ code: 'a', stripePriceId: 'price_a' }),
        definition({ code: 'b', stripePriceId: 'price_b' }),
      ]);

      expect(outcome).toEqual({ result: 'applied', created: 2, updated: 0, unchanged: 0 });
    });

    it('is idempotent: the same catalog twice writes nothing the second time', async () => {
      const catalog = [definition({ code: 'a', stripePriceId: 'price_a' })];
      await upsert(catalog);
      repository.upserts.length = 0;

      const outcome = await upsert(catalog);

      expect(outcome).toEqual({ result: 'applied', created: 0, updated: 0, unchanged: 1 });
      expect(repository.upserts).toEqual([]);
    });

    it.each([
      ['the limit', { activeJourneyLimit: 8 }],
      ['the displayed price', { price: new Decimal('249.90') }],
      ['the name', { name: 'Outro nome' }],
      ['the interval', { interval: 'year' as const }],
      ['the sort order', { sortOrder: 99 }],
      ['the status (withdrawing it)', { status: 'WITHDRAWN' as const }],
    ])('updates an existing plan when %s changes', async (_label, change) => {
      await upsert([definition({ code: 'a', stripePriceId: 'price_a' })]);

      const outcome = await upsert([
        definition({ code: 'a', stripePriceId: 'price_a', ...change }),
      ]);

      expect(outcome).toEqual({ result: 'applied', created: 0, updated: 1, unchanged: 0 });
      expect(await service.findByCode('a')).toMatchObject(change);
    });

    it('BR-012-02: a mix of new, changed and unchanged plans counts each', async () => {
      await upsert([
        definition({ code: 'a', stripePriceId: 'price_a' }),
        definition({ code: 'b', stripePriceId: 'price_b' }),
      ]);

      const outcome = await upsert([
        definition({ code: 'a', stripePriceId: 'price_a' }),
        definition({ code: 'b', stripePriceId: 'price_b', activeJourneyLimit: 9 }),
        definition({ code: 'c', stripePriceId: 'price_c' }),
      ]);

      expect(outcome).toEqual({ result: 'applied', created: 1, updated: 1, unchanged: 1 });
    });

    it('refuses a provider price that belongs to another plan, and writes nothing at all', async () => {
      await upsert([definition({ code: 'a', stripePriceId: 'price_a' })]);
      repository.upserts.length = 0;

      const outcome = await upsert([
        definition({ code: 'fresh', stripePriceId: 'price_fresh' }),
        definition({ code: 'copycat', stripePriceId: 'price_a' }),
      ]);

      expect(outcome).toEqual({ result: 'refused_duplicate_price', conflicts: 1 });
      expect(repository.upserts).toEqual([]);
      expect(await service.findByCode('fresh')).toBeNull();
    });

    it('refuses to change the provider price of an existing code (subscribers keep paying it), writing nothing', async () => {
      await upsert([definition({ code: 'a', stripePriceId: 'price_a' })]);
      repository.upserts.length = 0;

      const outcome = await upsert([
        definition({ code: 'a', stripePriceId: 'price_a2', activeJourneyLimit: 9 }),
        definition({ code: 'fresh', stripePriceId: 'price_fresh' }),
      ]);

      expect(outcome).toEqual({ result: 'refused_price_changed', conflicts: 1 });
      expect(repository.upserts).toEqual([]);
      expect(await service.findByCode('a')).toMatchObject({
        stripePriceId: 'price_a',
        activeJourneyLimit: 5,
      });
    });

    describe('BR-012-02: the price is checked at the provider before anything is written', () => {
      const catalog = () => [
        definition({ code: 'ok', stripePriceId: 'price_ok' }),
        definition({ code: 'bad', stripePriceId: 'price_bad' }),
      ];

      it.each([
        ['does not exist', null],
        ['is archived while the plan is offered', { active: false }],
        ['charges another amount', { amount: new Decimal('199.91') }],
        ['bills another interval', { interval: 'year' as const }],
        ['is in another currency', { currency: 'usd' }],
        ['bills every 3 months', { intervalCount: 3 }],
        ['has no interval count', { intervalCount: null }],
        ['is metered, not licensed', { licensed: false }],
        ['is tiered, not per unit', { perUnit: false }],
      ])('refuses a catalog whose price %s, and writes nothing', async (_label, divergence) => {
        const plans = catalog();
        plans.forEach((plan) => providerHas(plan));
        if (divergence === null) gateway.prices.delete('price_bad');
        else providerHas(plans[1] as PlanDefinition, divergence);

        const outcome = await service.upsertCatalog(plans);

        expect(outcome).toEqual({ result: 'refused_price_mismatch', conflicts: 1 });
        expect(repository.upserts).toEqual([]);
        expect(await service.findByCode('ok')).toBeNull();
      });

      it('BR-012-04: a withdrawn plan may keep an archived price (subscribers still pay it)', async () => {
        const withdrawn = definition({
          code: 'old',
          stripePriceId: 'price_old',
          status: 'WITHDRAWN',
        });
        providerHas(withdrawn, { active: false });

        expect(await service.upsertCatalog([withdrawn])).toEqual({
          result: 'applied',
          created: 1,
          updated: 0,
          unchanged: 0,
        });
      });

      it('counts every mismatch', async () => {
        const plans = catalog();

        expect(await service.upsertCatalog(plans)).toEqual({
          result: 'refused_price_mismatch',
          conflicts: 2,
        });
      });
    });
  });
});
