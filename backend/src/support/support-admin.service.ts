// SPEC-009 BR-009-10, BR-009-12: the admin's side of support requests. The admin reads the message sent
// to support and who sent it (to answer by email, outside the product), closes the request and opens a
// support access grant on it. Reading a request needs no grant: it is the message addressed to support.
// The requester's CLIENT data, however, has exactly one door, the grant (BR-002-24): this service
// delegates opening to `SupportGrantService.open` and ending to `endForSupportRequest`, and builds no
// path of its own to anything the requester keeps in the product.
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../access/access-context.js';
import { canonicalObjectId, isObjectIdString } from '../access/owner-filter.js';
import { type OpenedGrant, SupportGrantService } from '../admin-access/support-grant.service.js';
import { DomainError } from '../common/errors/domain-error.js';
import { type PageRequest, type Paginated, paginated } from '../common/pagination/paginated.js';
import { Clock } from '../common/clock/clock.js';
import { UsersService } from '../users/users.service.js';
import type { SupportRequestStatus } from './domain/support-request.js';
import { SupportRequestAdminDetailDto } from './dto/support-admin-response.dto.js';
import {
  type SupportRequestRecord,
  SupportRequestsRepository,
} from './support-requests.repository.js';

/** The request's id in its one spelling; a malformed one is the same NOT_FOUND as a missing one (AR-14). */
function requestId(requested: string): string {
  if (!isObjectIdString(requested)) throw new DomainError('NOT_FOUND');
  return canonicalObjectId(requested);
}

/** BR-002-23: every method acts for an admin; the route's `@AdminOnly()` is the first check, this the second. */
function assertAdmin(admin: AccessContext): void {
  if (!admin.isAdmin) throw new DomainError('FORBIDDEN');
}

@Injectable()
export class SupportAdminService {
  constructor(
    private readonly requests: SupportRequestsRepository,
    private readonly users: UsersService,
    private readonly grants: SupportGrantService,
    private readonly clock: Clock, // AR-24
  ) {}

  /** BR-009-12: the support queue, newest first (AR-35), optionally one status. */
  async list(
    admin: AccessContext,
    query: PageRequest & { readonly status?: SupportRequestStatus },
  ): Promise<Paginated<SupportRequestRecord>> {
    assertAdmin(admin);
    const { items, total } = await this.requests.pageAcrossAccounts(
      query.status ? { status: query.status } : {},
      query,
    );
    return paginated(items, total, query);
  }

  /** One request, the requester's name and email, and the grant THIS admin holds on it (null if none). */
  async detail(admin: AccessContext, requested: string): Promise<SupportRequestAdminDetailDto> {
    assertAdmin(admin);
    const id = requestId(requested);
    const request = await this.requests.findByIdAcrossAccounts(id);
    if (!request) throw new DomainError('NOT_FOUND'); // a malformed id is the same
    const [requester, grant] = await Promise.all([
      this.users.findById(request.userId.toHexString()),
      this.grants.ownGrantFor(admin, id),
    ]);
    return new SupportRequestAdminDetailDto(
      request,
      requester ? { name: requester.name, email: requester.email } : null,
      grant,
    );
  }

  /**
   * BR-009-12: marks the request closed, which ends any grant tied to it (BR-002-26). Idempotent: an
   * already closed request answers as it is, and the grants are ended again (so one a race left open is
   * closed too). The order is safe whichever way it interleaves: the request is closed FIRST, and every
   * read under a grant re-reads the request, so a grant opened between the two writes is refused on its
   * first read.
   */
  async close(admin: AccessContext, requested: string): Promise<SupportRequestAdminDetailDto> {
    assertAdmin(admin);
    const id = requestId(requested);
    const outcome = await this.requests.closeAcrossAccounts(id, admin.accountId, this.clock.now());
    if (outcome === 'not_found') throw new DomainError('NOT_FOUND');
    await this.grants.endForSupportRequest(id, 'closed');
    return this.detail(admin, id);
  }

  /**
   * BR-002-24: opens (or returns) THIS admin's grant on the request, through the grant service, which
   * refuses with the same NOT_FOUND an unknown, closed, never-permitted, withdrawn or another admin's
   * request (no oracle). The route answers the grant and nothing of the requester's data.
   */
  async openGrant(admin: AccessContext, requested: string): Promise<OpenedGrant> {
    assertAdmin(admin);
    return this.grants.open(admin, requestId(requested));
  }
}
