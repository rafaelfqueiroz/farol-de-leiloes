// SPEC-002 seam, plugged by SPEC-012 (plans and subscriptions). AccessContextFactory reads it on
// every request (AR-13, BR-002-15): a plan that lapsed beyond its grace period makes the office
// read-only on the next request, whatever the interface still shows (BR-002-30, D-47).
//
// SPEC-012 binds `SubscriptionOfficePlanSource` (subscriptions/subscription-office-plan.source.ts)
// to OFFICE_PLAN_SOURCE in AccessModule. An office missing from the answer is treated as having no
// active advisor plan, no entitlement and read-only (AccessContextFactory): unknown plan state fails
// closed (BR-002-10). `NoOfficePlanSource` below is that answer for every office; it is what unit
// specs use when they do not exercise plans.
//
// BR-002-21: the binding is made inside AccessModule (access.module.ts, importing the owning spec's
// module), never in another module: AccessModule is the one place the API (through AuthModule) and
// `npm run grant-admin` (GrantAdminModule) both read it from, so a binding elsewhere would leave one
// of them on a different implementation. Enforced by test/structural/access-source-bindings.spec.ts.

/** What an office's stored subscription says right now. */
export interface OfficePlanState {
  /** BR-002-14: the office's advisor plan is active, so its members are advisors. */
  readonly advisorPlanActive: boolean;
  /** BR-002-30 / SPEC-012 BR-012-28: lapsed beyond the grace period; writes refused. */
  readonly readOnly: boolean;
  /** The features the plan includes (BR-002-13). */
  readonly entitlements: readonly string[];
}

export interface OfficePlanSource {
  /** The plan state of each office asked for, by office id. */
  officePlans(officeIds: readonly string[]): Promise<ReadonlyMap<string, OfficePlanState>>;
  /** The features a self-advised account has (SPEC-011 self-advised limit, SPEC-012). */
  selfAdvisedEntitlements(accountId: string): Promise<readonly string[]>;
}

export const OFFICE_PLAN_SOURCE = Symbol('OFFICE_PLAN_SOURCE');

/** No plan is known: every office is absent, so none has a plan and every one is read-only. */
export class NoOfficePlanSource implements OfficePlanSource {
  officePlans(): Promise<ReadonlyMap<string, OfficePlanState>> {
    return Promise.resolve(new Map());
  }

  selfAdvisedEntitlements(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }
}
