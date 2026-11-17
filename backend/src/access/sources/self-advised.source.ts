// SPEC-002 seam, plugged by SPEC-011 (the self-advised status). AccessContextFactory reads it on
// every request (AR-13, BR-002-15).
//
// Until SPEC-011 binds a real implementation to SELF_ADVISED_SOURCE (in AccessModule), the default
// says no account is self-advised, which is the safe direction to fail (BR-002-10).
//
// BR-002-21: the real binding MUST be made inside AccessModule (access.module.ts, importing the
// owning spec's module if it needs its services), never in another module: AccessModule is the one
// place the API (through AuthModule) and `npm run grant-admin` (GrantAdminModule) both read it from,
// so a binding elsewhere would leave one of them on this permissive default. Enforced by
// test/structural/access-source-bindings.spec.ts.

export interface SelfAdvisedSource {
  /** Whether the account currently conducts its own journeys (RF-CON-11). */
  isSelfAdvised(accountId: string): Promise<boolean>;
}

export const SELF_ADVISED_SOURCE = Symbol('SELF_ADVISED_SOURCE');

/** Before SPEC-011: nobody is self-advised. */
export class NoSelfAdvisedSource implements SelfAdvisedSource {
  isSelfAdvised(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
