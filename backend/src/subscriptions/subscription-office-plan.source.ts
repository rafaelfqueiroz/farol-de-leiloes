// SPEC-012 BR-012-21, BR-012-28 / SPEC-002 BR-002-30: the OFFICE_PLAN_SOURCE implementation.
// AccessContextFactory reads it on EVERY request (AR-13, BR-002-15), so a lapse beyond the grace
// period makes the office read-only on the next request, and a new payment lifts it at once, with
// no job in between: `readOnly` is computed here from the stored `lapsedAt`, the injected clock
// and the grace setting.
//
// It is bound to the token in AccessModule ONLY (BR-002-21, test/structural/
// access-source-bindings.spec.ts), so the API and `npm run grant-admin` read the same thing.
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { OfficePlanSource, OfficePlanState } from '../access/sources/office-plan.source.js';
import { Clock } from '../common/clock/clock.js';
import businessConfig from '../config/business.config.js';
import { deriveOfficePlanState, type SubscriptionFacts } from './domain/office-plan-state.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';

@Injectable()
export class SubscriptionOfficePlanSource implements OfficePlanSource {
  constructor(
    private readonly subscriptions: SubscriptionsRepository,
    private readonly clock: Clock, // AR-24
    @Inject(businessConfig.KEY) private readonly config: ConfigType<typeof businessConfig>,
  ) {}

  /**
   * One `$in` query for all the offices asked for. An office with no confirmed subscription is
   * absent from the answer, which SPEC-002 reads as: no plan, no entitlement, read-only (fail
   * closed).
   */
  async officePlans(officeIds: readonly string[]): Promise<ReadonlyMap<string, OfficePlanState>> {
    const rows = await this.subscriptions.findDecidingForOffices(officeIds);
    const byOffice = new Map<string, SubscriptionFacts[]>();
    for (const row of rows) {
      byOffice.set(row.officeId, [...(byOffice.get(row.officeId) ?? []), row]);
    }
    const now = this.clock.now();
    const plans = new Map<string, OfficePlanState>();
    for (const [officeId, subscriptions] of byOffice) {
      const state = deriveOfficePlanState(subscriptions, now, this.config.subscriptions.graceDays);
      if (state !== null) plans.set(officeId, state);
    }
    return plans;
  }

  /** BR-012-27: the self-advised investor's limit of 3 is not a plan; no subscription gives any. */
  selfAdvisedEntitlements(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}
