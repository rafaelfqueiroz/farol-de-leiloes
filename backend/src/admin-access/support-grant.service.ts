// SPEC-002 BR-002-23..BR-002-26 / DL-002-04: support access grants, the admin's ONLY path to client
// data. A grant exists only for a support request its requester opened and in which they allowed
// the support team to view their data (SPEC-009 BR-009-08); it shows exactly the requester's own
// current view, read-only (BR-002-25); and it ends at the first of: the request is closed, the
// permission withdrawn, or 7 days pass (BR-002-26, domain/grant-validity.ts).
//
// Every refusal about a grant or a support request is the same NOT_FOUND as a nonexistent one, so
// the answer never tells the admin whether a request exists, is closed, was never shared, or has
// an open grant another admin holds.
//
// Reads under a grant go through `contextForRead`, which re-checks the grant against the CURRENT
// support request and the Clock on every call (AR-13, AR-24). The view it builds
// (AccessContextFactory.supportGrantView: read-only, client data only, never the account's own
// data, BR-002-02/23) is SEALED in the SupportGrantRead it returns (grant-context.ts): the read has
// no property to read with, so the data comes only through GrantReadLogger, which logs each record
// before it is returned (BR-002-27). See ARCHITECTURE §4 for the route pattern.
import { Inject, Injectable } from '@nestjs/common';
import { type AccessContext, AccessContextFactory } from '../access/access-context.js';
import { isObjectIdString } from '../access/owner-filter.js';
import {
  SUPPORT_REQUEST_SOURCE,
  type SupportRequestForGrant,
  type SupportRequestSource,
} from '../access/sources/support-request.source.js';
import { Clock } from '../common/clock/clock.js';
import { DomainError } from '../common/errors/domain-error.js';
import { UsersService } from '../users/users.service.js';
import { isAccountActive } from '../users/user-account.js';
import { grantExpiresAt, grantValidity } from './domain/grant-validity.js';
import { sealGrantContext } from './grant-context.js';
import {
  type StoredGrant,
  SupportAccessGrantRepository,
} from './support-access-grant.repository.js';

/** A grant as its admin sees it (no requester data: SC-15). */
export interface OpenedGrant {
  readonly id: string;
  readonly supportRequestId: string;
  readonly openedAt: Date;
  readonly expiresAt: Date;
}

// Never exported: only SupportGrantService.contextForRead builds a SupportGrantRead.
const MINT: unique symbol = Symbol('SupportGrantRead.mint');

interface SupportGrantReadFields {
  readonly grantId: string;
  readonly supportRequestId: string;
  readonly adminUserId: string;
  readonly requesterUserId: string;
  readonly context: AccessContext;
}

/**
 * One validated read under a grant: the grant it went through, and — sealed, not a property — the
 * requester's view (BR-002-25). Built by `SupportGrantService.contextForRead` only, for one
 * request; never kept across requests (AR-13). Its view is opened by GrantReadLogger alone
 * (grant-context.ts), so a handler cannot read with it and skip the log (BR-002-27).
 */
export class SupportGrantRead {
  readonly grantId: string;
  readonly supportRequestId: string;
  readonly adminUserId: string;
  readonly requesterUserId: string;

  constructor(token: typeof MINT, fields: SupportGrantReadFields) {
    if (token !== MINT) {
      throw new Error('A grant read is built by SupportGrantService.contextForRead only');
    }
    this.grantId = fields.grantId;
    this.supportRequestId = fields.supportRequestId;
    this.adminUserId = fields.adminUserId;
    this.requesterUserId = fields.requesterUserId;
    sealGrantContext(this, fields.context);
    Object.freeze(this);
  }
}

export type SupportGrantEndReason = 'closed' | 'withdrawn';

/** How many times `open` retries its insert after finding a stale open grant in the way. */
const OPEN_ATTEMPTS = 3;

function toOpened(grant: StoredGrant): OpenedGrant {
  return Object.freeze({
    id: grant.id,
    supportRequestId: grant.supportRequestId,
    openedAt: grant.openedAt,
    expiresAt: grant.expiresAt,
  });
}

@Injectable()
export class SupportGrantService {
  constructor(
    private readonly grants: SupportAccessGrantRepository,
    @Inject(SUPPORT_REQUEST_SOURCE) private readonly supportRequests: SupportRequestSource,
    private readonly users: UsersService,
    private readonly contexts: AccessContextFactory,
    private readonly clock: Clock,
  ) {}

  /**
   * BR-002-24: opens (or returns) the admin's grant for a support request. The request must exist,
   * be open, and have its requester's permission to view their data; the requester must be an
   * active account without the admin capability (BR-002-21). Anything else is the same NOT_FOUND
   * as a request that does not exist (no oracle).
   *
   * Idempotent and race-safe: the partial unique index (migration 0005, AR-29) allows one grant
   * per request that has not ended, so concurrent opens end with ONE grant and every caller of the
   * same admin gets it. A request whose open grant ANOTHER admin holds answers the same NOT_FOUND
   * (no oracle: the answer never says a grant exists, nor whose it is).
   */
  async open(adminCtx: AccessContext, supportRequestId: string): Promise<OpenedGrant> {
    if (!adminCtx.isAdmin || adminCtx.readOnly) throw new DomainError('FORBIDDEN'); // BR-002-23
    const request = await this.shareableRequest(supportRequestId);
    if (!request || !(await this.isActiveNonAdmin(request.requesterUserId))) {
      throw new DomainError('NOT_FOUND');
    }
    for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt += 1) {
      const now = this.clock.now();
      const created = await this.grants.insertOpen({
        supportRequestId: request.id,
        adminUserId: adminCtx.accountId,
        requesterUserId: request.requesterUserId,
        openedAt: now,
        expiresAt: grantExpiresAt(now),
      });
      if (created) return toOpened(created);

      const existing = await this.grants.findOpenForSupportRequest(request.id);
      if (!existing) continue; // it ended between the two calls: insert again
      const validity = grantValidity(existing, request, now);
      if (!validity.valid) {
        // An expired grant nobody read since: record its end, then open a new one (BR-002-26).
        await this.grants.endIfOpen(existing.id, validity.endedAt, validity.reason);
        continue;
      }
      if (existing.adminUserId !== adminCtx.accountId) throw new DomainError('NOT_FOUND');
      return toOpened(existing);
    }
    // Only a pathological race lands here (the grant keeps ending and reappearing): a fault.
    throw new Error('Could not open a support access grant after several attempts');
  }

  /**
   * BR-002-24..BR-002-26: the context a read under this grant uses, or NOT_FOUND. Re-checked on
   * EVERY call: the grant must be this admin's and still open, the support request (read now)
   * open with the permission in place, and the 7 days not passed (Clock). A grant found ended is
   * recorded as ended (conditional, once) before the refusal.
   *
   * On success the view is the requester's CURRENT context (AccessContextFactory.forAccount: their
   * memberships and links as of this request, AR-13) made a grant view (supportGrantView): it reads
   * the client data the requester reads, never their own account data (BR-002-02, BR-002-23), and
   * writes nothing (BR-002-25). It is sealed in the returned SupportGrantRead: only GrantReadLogger
   * reads with it, logging every record before it is returned (BR-002-27).
   */
  async contextForRead(adminCtx: AccessContext, grantId: string): Promise<SupportGrantRead> {
    if (!adminCtx.isAdmin || adminCtx.readOnly) throw new DomainError('NOT_FOUND');
    const grant = await this.grants.findForAdmin(grantId, adminCtx.accountId);
    if (!grant || grant.status !== 'open') throw new DomainError('NOT_FOUND');

    const request = await this.supportRequests.findForGrant(grant.supportRequestId);
    // A request that now names another requester is not the request the grant was opened on.
    const sameRequest = request && request.requesterUserId === grant.requesterUserId;
    const validity = grantValidity(grant, sameRequest ? request : null, this.clock.now());
    if (!validity.valid) {
      await this.grants.endIfOpen(grant.id, validity.endedAt, validity.reason);
      throw new DomainError('NOT_FOUND');
    }
    // BR-002-21 / BR-002-25: never the view of an admin, nor of an account no longer active.
    if (!(await this.isActiveNonAdmin(grant.requesterUserId))) throw new DomainError('NOT_FOUND');

    const requesterContext = await this.contexts.forAccount({
      userId: grant.requesterUserId,
      isAdmin: false,
    });
    return new SupportGrantRead(MINT, {
      grantId: grant.id,
      supportRequestId: grant.supportRequestId,
      adminUserId: grant.adminUserId,
      requesterUserId: grant.requesterUserId,
      context: this.contexts.supportGrantView(requesterContext),
    });
  }

  /**
   * BR-002-26: SPEC-009 calls this when the support request is closed or the requester withdraws
   * the permission, so the grant ends at that moment (the next read would end it anyway). Expiry
   * needs no call and no job: `contextForRead` refuses and records it lazily. True when a grant
   * was open and is now ended.
   */
  endForSupportRequest(supportRequestId: string, reason: SupportGrantEndReason): Promise<boolean> {
    return this.grants.endOpenForSupportRequest(supportRequestId, this.clock.now(), reason);
  }

  /** The request when a grant may be opened on it now; null for every other case alike. */
  private async shareableRequest(supportRequestId: string): Promise<SupportRequestForGrant | null> {
    if (!isObjectIdString(supportRequestId)) return null; // SC-10: never a query operator
    const request = await this.supportRequests.findForGrant(supportRequestId);
    if (!request || request.id !== supportRequestId) return null;
    if (!request.open || !request.dataAccessAllowed) return null;
    return isObjectIdString(request.requesterUserId) ? request : null;
  }

  /** BR-002-21: the requester is an active account without the admin capability. */
  private async isActiveNonAdmin(userId: string): Promise<boolean> {
    if (!isObjectIdString(userId)) return false;
    const user = await this.users.findById(userId);
    if (!user) return false;
    return user.isAdmin !== true && isAccountActive(user);
  }
}
