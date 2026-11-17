// SPEC-002 seam, plugged by SPEC-009 (support requests). SupportGrantService reads it when an admin
// opens a support access grant and again on EVERY read under one (BR-002-24, BR-002-26): a request
// closed, or a permission withdrawn, a second ago ends the grant on the next read.
//
// Until SPEC-009 binds a real implementation to SUPPORT_REQUEST_SOURCE (in AccessModule), the
// default knows no support request at all, so no grant can be opened and the admin has no path to
// client data: the safe direction to fail (BR-002-24, DL-002-04).
//
// The binding MUST be made inside AccessModule (access.module.ts), like the other access sources:
// one place, so no context of the app can read a permissive implementation by accident. Enforced
// by test/structural/access-source-bindings.spec.ts.

/** What a grant needs to know about a support request, read now (never cached, AR-13). */
export interface SupportRequestForGrant {
  readonly id: string;
  /** The account that opened the request: whose data a grant may show (BR-002-24). */
  readonly requesterUserId: string;
  /** False once the request is closed (BR-002-26). */
  readonly open: boolean;
  /**
   * The requester explicitly allowed the support team to view their data in this request
   * (SPEC-009 BR-009-08). False when never given and once withdrawn (BR-002-24, BR-002-26).
   */
  readonly dataAccessAllowed: boolean;
}

export interface SupportRequestSource {
  /** The support request, or null when there is none with this id. */
  findForGrant(supportRequestId: string): Promise<SupportRequestForGrant | null>;
}

export const SUPPORT_REQUEST_SOURCE = Symbol('SUPPORT_REQUEST_SOURCE');

/** Before SPEC-009: there is no support request, so no grant can ever be opened (BR-002-24). */
export class NoSupportRequestSource implements SupportRequestSource {
  findForGrant(): Promise<SupportRequestForGrant | null> {
    return Promise.resolve(null);
  }
}
