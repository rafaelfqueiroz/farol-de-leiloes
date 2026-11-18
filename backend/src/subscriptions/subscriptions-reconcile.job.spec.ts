// SPEC-012 (ADR-005): the daily reconcile job heals what the webhook lost, through the same sync
// path, bounded, with counts-only logs. Against fakes of the provider, the store and the job log.
import { describe, expect, it, vi } from 'vitest';
import { JobStatus, RunMode } from '../common/job-execution.js';
import type { JobExecutionService } from '../common/services/job-execution.service.js';
import type { SchedulerConfig } from '../config/scheduler.config.js';
import type { PlansService } from '../plans/plans.service.js';
import { aPlan } from '../../test/builders/plan.builder.js';
import { aProviderSubscription } from '../../test/builders/provider-subscription.builder.js';
import { DAY, FakeClock, HOUR } from '../../test/fakes/fake-clock.js';
import { FakeOfficeProvisioner } from '../../test/fakes/fake-office-provisioner.js';
import { FakePaymentEventsRepository } from '../../test/fakes/fake-payment-events-repository.js';
import { FakePaymentFailedNotifier } from '../../test/fakes/fake-payment-failed-notifier.js';
import { FakePaymentGateway } from '../../test/fakes/fake-payment-gateway.js';
import { FakeSubscriptionsRepository } from '../../test/fakes/fake-subscriptions-repository.js';
import { InMemoryPlans } from '../../test/fakes/in-memory-plans.js';
import { expectNoneLogged, spyOnLogger } from '../../test/support/logger-spy.js';
import { testBusinessConfig } from '../../test/support/test-env.js';
import type { PaymentEventsRepository } from './payment-events.repository.js';
import {
  RECONCILE_BATCH_SIZE,
  SUBSCRIPTIONS_RECONCILE_JOB,
  SubscriptionsReconcileJob,
} from './subscriptions-reconcile.job.js';
import type { SubscriptionsRepository } from './subscriptions.repository.js';
import { SubscriptionsService } from './subscriptions.service.js';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const BUYER = '64b7f0000000000000000b01';
const PLAN = aPlan({ stripePriceId: 'price_5' });

class FakeJobs {
  readonly successes: Array<{ job: string; mode: RunMode }> = [];
  readonly failures: Array<{ job: string; mode: RunMode; code: string }> = [];
  async recordExecution(job: string, mode: RunMode) {
    this.successes.push({ job, mode });
    return { jobName: job, runMode: mode, finishedAt: NOW, status: JobStatus.SUCCESS };
  }
  async recordFailure(job: string, mode: RunMode, code: string) {
    this.failures.push({ job, mode, code });
    return { jobName: job, runMode: mode, finishedAt: NOW, status: JobStatus.FAILED };
  }
}

function build(enabled = true) {
  const clock = new FakeClock(NOW);
  const gateway = new FakePaymentGateway();
  const subscriptions = new FakeSubscriptionsRepository(() => clock.now());
  const jobs = new FakeJobs();
  const sync = new SubscriptionsService(
    subscriptions as unknown as SubscriptionsRepository,
    new FakePaymentEventsRepository() as unknown as PaymentEventsRepository,
    new InMemoryPlans([PLAN]) as unknown as PlansService,
    gateway,
    clock,
    new FakeOfficeProvisioner(),
    new FakePaymentFailedNotifier(),
    testBusinessConfig(),
  );
  const config = { subscriptionsReconcile: { enabled } } as unknown as SchedulerConfig;
  const job = new SubscriptionsReconcileJob(
    subscriptions as unknown as SubscriptionsRepository,
    sync,
    jobs as unknown as JobExecutionService,
    clock,
    config,
  );

  let sequence = 0;
  /** A record the provider knows (id `sub_n`), last synced `syncedHoursAgo`, in this state. */
  async function known(
    options: {
      status?: 'ACTIVE' | 'LAPSED' | 'PENDING';
      syncedHoursAgo?: number | null;
      lapsedDaysAgo?: number;
      providerStatus?: Parameters<typeof aProviderSubscription>[0] extends infer O
        ? O extends { status?: infer S }
          ? S
          : never
        : never;
    } = {},
  ) {
    sequence += 1;
    const created = await subscriptions.createPending({
      buyerUserId: BUYER,
      planId: PLAN.id,
      planCode: PLAN.code,
      activeJourneyLimit: PLAN.activeJourneyLimit,
      officeId: `64b7f00000000000000c${String(sequence).padStart(4, '0')}`,
    });
    const row = subscriptions.rows.get(created.id);
    if (!row) throw new Error('no row');
    row.stripeSubscriptionId = `sub_${sequence}`;
    row.status = options.status ?? 'ACTIVE';
    const hours = options.syncedHoursAgo === undefined ? 13 : options.syncedHoursAgo;
    row.lastSyncedAt = hours === null ? null : new Date(NOW.getTime() - hours * HOUR);
    row.firstPaidAt = new Date(NOW.getTime() - 40 * DAY);
    if (options.lapsedDaysAgo !== undefined) {
      row.lapsedAt = new Date(NOW.getTime() - options.lapsedDaysAgo * DAY);
    }
    gateway.setSubscription(
      aProviderSubscription({
        id: `sub_${sequence}`,
        subscriptionRef: created.id,
        priceId: 'price_5',
        status: options.providerStatus ?? 'active',
      }),
    );
    return created.id;
  }
  return { clock, gateway, subscriptions, jobs, job, known };
}

describe('SubscriptionsReconcileJob', () => {
  it('ADR-005: heals a lost `deleted` event: an ACTIVE record the provider shows canceled becomes LAPSED', async () => {
    const t = build();
    const id = await t.known({ providerStatus: 'canceled' });

    const outcome = await t.job.run();

    expect(outcome).toEqual({ reread: 1, healed: 1, failed: 0, purged: 0 });
    expect(t.subscriptions.get(id)).toMatchObject({ status: 'LAPSED', lapsedAt: NOW });
  });

  it('ADR-005: heals a lost renewal-failure event: ACTIVE becomes PAST_DUE', async () => {
    const t = build();
    const id = await t.known({ providerStatus: 'past_due' });

    await t.job.run();

    expect(t.subscriptions.get(id).status).toBe('PAST_DUE');
  });

  it('re-reads only what was last synced more than 12 hours ago (or never)', async () => {
    const t = build();
    await t.known({ syncedHoursAgo: 11 });
    await t.known({ syncedHoursAgo: 12 }); // the boundary: not older than 12 h
    const stale = await t.known({ syncedHoursAgo: 13 });
    const never = await t.known({ syncedHoursAgo: null });

    await t.job.run();

    expect(t.gateway.retrievals.sort()).toEqual([`sub_3`, `sub_4`].sort());
    expect(t.subscriptions.get(stale).lastSyncedAt).toEqual(NOW);
    expect(t.subscriptions.get(never).lastSyncedAt).toEqual(NOW);
  });

  it('re-reads subscriptions that lapsed in the last 14 days (a late reactivation) and not older ones', async () => {
    const t = build();
    await t.known({ status: 'LAPSED', lapsedDaysAgo: 13, providerStatus: 'canceled' });
    await t.known({ status: 'LAPSED', lapsedDaysAgo: 15, providerStatus: 'canceled' });

    await t.job.run();

    expect(t.gateway.retrievals).toEqual(['sub_1']);
  });

  it('a lapsed record the provider shows active again is reactivated (a payment the webhook never told us)', async () => {
    const t = build();
    const id = await t.known({ status: 'LAPSED', lapsedDaysAgo: 3, providerStatus: 'active' });

    const outcome = await t.job.run();

    expect(outcome?.healed).toBe(1);
    expect(t.subscriptions.get(id)).toMatchObject({ status: 'ACTIVE', lapsedAt: null });
  });

  it('never reads a checkout that has no provider subscription yet', async () => {
    const t = build();
    await t.subscriptions.createPending({
      buyerUserId: BUYER,
      planId: PLAN.id,
      planCode: PLAN.code,
      activeJourneyLimit: 5,
      openCheckoutKey: `buyer:${BUYER}`,
    });

    const outcome = await t.job.run();

    expect(outcome?.reread).toBe(0);
    expect(t.gateway.retrievals).toEqual([]);
  });

  it('acceptance: removes PENDING checkouts with no provider subscription older than 3 days, and only those', async () => {
    const t = build();
    const create = (key: string) =>
      t.subscriptions.createPending({
        buyerUserId: BUYER,
        planId: PLAN.id,
        planCode: PLAN.code,
        activeJourneyLimit: 5,
        openCheckoutKey: key,
      });
    const old = await create('buyer:old');
    t.clock.advance(3 * DAY); // `old` is exactly 3 days old now: not yet beyond
    const boundary = await create('buyer:boundary');
    t.clock.advance(1 * HOUR);
    const paid = await t.known({ syncedHoursAgo: 1 });

    const outcome = await t.job.run();

    expect(outcome?.purged).toBe(1);
    expect(t.subscriptions.rows.has(old.id)).toBe(false);
    expect(t.subscriptions.rows.has(boundary.id)).toBe(true);
    expect(t.subscriptions.rows.has(paid)).toBe(true);
  });

  it('is bounded: one run re-reads the oldest syncs first and at most a batch', async () => {
    const t = build();
    for (let n = 0; n < RECONCILE_BATCH_SIZE + 5; n += 1) await t.known({ syncedHoursAgo: 20 });

    const outcome = await t.job.run();

    expect(outcome?.reread).toBe(RECONCILE_BATCH_SIZE);
  });

  it('AR-03: a record that cannot be read does not stop the others, and the run is recorded as failed', async () => {
    const t = build();
    await t.known({ providerStatus: 'canceled' });
    const lost = await t.known();
    const missing = (id: string) => id === 'sub_2';
    const original = t.gateway.onRetrieve;
    t.gateway.onRetrieve = (id) => {
      if (missing(id)) throw new Error('provider unreachable');
      return original?.(id);
    };

    const outcome = await t.job.run();

    expect(outcome).toEqual({ reread: 1, healed: 1, failed: 1, purged: 0 });
    expect(t.subscriptions.get(lost).lastSyncedAt).not.toEqual(NOW);
    expect(t.jobs.failures).toEqual([
      { job: SUBSCRIPTIONS_RECONCILE_JOB, mode: RunMode.AUTO, code: 'PARTIAL_FAILURE' },
    ]);
    expect(t.jobs.successes).toEqual([]);
  });

  it('AR-03: a clean run is recorded as a success', async () => {
    const t = build();
    await t.known();

    await t.job.run();

    expect(t.jobs.successes).toEqual([{ job: SUBSCRIPTIONS_RECONCILE_JOB, mode: RunMode.AUTO }]);
  });

  it('AR-03: a run that fails as a whole is recorded with its stable code and does not throw', async () => {
    const t = build();
    t.subscriptions.findIdsToReconcile = () => Promise.reject(new TypeError('boom'));

    await expect(t.job.run()).resolves.toBeNull();

    expect(t.jobs.failures).toEqual([
      { job: SUBSCRIPTIONS_RECONCILE_JOB, mode: RunMode.AUTO, code: 'TypeError' },
    ]);
  });

  it('is idempotent: a second run right after finds everything fresh', async () => {
    const t = build();
    await t.known({ providerStatus: 'canceled' });
    await t.job.run();

    expect(await t.job.run()).toEqual({ reread: 0, healed: 0, failed: 0, purged: 0 });
  });

  it('AR-04: with SUBSCRIPTIONS_RECONCILE_ENABLED off the cron does nothing at all', async () => {
    const t = build(false);
    await t.known({ providerStatus: 'canceled' });

    await t.job.reconcileDaily();

    expect(t.gateway.retrievals).toEqual([]);
    expect(t.jobs.successes).toEqual([]);
  });

  it('runs from the cron when enabled', async () => {
    const t = build();
    await t.known();

    await t.job.reconcileDaily();

    expect(t.jobs.successes).toHaveLength(1);
  });

  it('SC-15: the log carries counts and ids, never a personal value', async () => {
    const logger = spyOnLogger();
    const t = build();
    await t.known({ providerStatus: 'canceled' });

    await t.job.run();

    const logged = logger.loggedText();
    expect(logged).toContain('1 re-read, 1 healed, 0 failed');
    expectNoneLogged(logged, ['cus_test_1', '@']);
    vi.restoreAllMocks();
  });
});
