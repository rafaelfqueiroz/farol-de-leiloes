// SPEC-002 part 3: a hand-written fake of the SUPPORT_REQUEST_SOURCE seam (TS-03), standing in for
// SPEC-009's support requests. A spec opens, closes and shares requests between two calls; the
// service reads it on every grant read, like the real source will (BR-002-26).
import type {
  SupportRequestForGrant,
  SupportRequestSource,
} from '../../src/access/sources/support-request.source.js';

export class FakeSupportRequests implements SupportRequestSource {
  private readonly requests = new Map<string, SupportRequestForGrant>();

  /** Creates or replaces a request (open, data access allowed, unless said otherwise). */
  set(
    id: string,
    requesterUserId: string,
    state: Partial<Pick<SupportRequestForGrant, 'open' | 'dataAccessAllowed'>> = {},
  ): this {
    this.requests.set(id, {
      id,
      requesterUserId,
      open: state.open ?? true,
      dataAccessAllowed: state.dataAccessAllowed ?? true,
    });
    return this;
  }

  /** Changes a request's state (SPEC-009 closing it, or the requester withdrawing permission). */
  update(id: string, state: Partial<Pick<SupportRequestForGrant, 'open' | 'dataAccessAllowed'>>) {
    const request = this.requests.get(id);
    if (!request) throw new Error(`No fake support request ${id}`);
    this.requests.set(id, { ...request, ...state });
  }

  delete(id: string): void {
    this.requests.delete(id);
  }

  clear(): void {
    this.requests.clear();
  }

  findForGrant(supportRequestId: string): Promise<SupportRequestForGrant | null> {
    return Promise.resolve(this.requests.get(supportRequestId) ?? null);
  }
}
