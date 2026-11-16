// SPEC-002 seam, plugged by SPEC-011 (client links) and SPEC-016 (journeys as investor).
// AccessContextFactory reads it on every request (AR-13, BR-002-15): a link that ended a second ago
// is ended on the next request (BR-002-07).
//
// Until a real implementation is bound to CLIENT_LINK_SOURCE (in AccessModule), the default says
// the account is nobody's client, which is the safe direction to fail (BR-002-10).
import type { ClientLinkFacts } from '../domain/personas.js';

/** An active or ended link; `endedAt` is set once it ended (BR-002-07). */
export type ClientLink = ClientLinkFacts;

export interface ClientLinkSource {
  /**
   * The account's links, as investor, that are `active` or `ended`. A pending invitation grants
   * nothing and is never returned (D-45); the domain drops one that slips through.
   */
  clientLinks(accountId: string): Promise<readonly ClientLink[]>;
  /** SPEC-016: whether the account is the investor of at least one journey (BR-002-14). */
  hasJourneyAsInvestor(accountId: string): Promise<boolean>;
}

export const CLIENT_LINK_SOURCE = Symbol('CLIENT_LINK_SOURCE');

/** Before SPEC-011 and SPEC-016: no account is anybody's client or a journey's investor. */
export class NoClientLinkSource implements ClientLinkSource {
  clientLinks(): Promise<readonly ClientLink[]> {
    return Promise.resolve([]);
  }

  hasJourneyAsInvestor(): Promise<boolean> {
    return Promise.resolve(false);
  }
}
