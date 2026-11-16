// SPEC-002 seam, plugged by SPEC-011 (offices and members). AccessContextFactory reads it on every
// request (AR-13, BR-002-15): a member removed a second ago is not a member on the next request.
//
// Until SPEC-011 binds a real implementation to MEMBERSHIP_SOURCE (in AccessModule), the default
// says nobody is a member of anything, which is the safe direction to fail (BR-002-10).

/** A current membership of the account in an office. A removed member has none (BR-002-16). */
export interface OfficeMembership {
  readonly officeId: string;
}

export interface MembershipSource {
  /** The offices the account is a current member of, read now, never from a cache. */
  activeMemberships(accountId: string): Promise<readonly OfficeMembership[]>;
}

export const MEMBERSHIP_SOURCE = Symbol('MEMBERSHIP_SOURCE');

/** Before SPEC-011: no account belongs to any office. */
export class NoMembershipSource implements MembershipSource {
  activeMemberships(): Promise<readonly OfficeMembership[]> {
    return Promise.resolve([]);
  }
}
