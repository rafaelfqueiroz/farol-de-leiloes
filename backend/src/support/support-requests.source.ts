// SPEC-009 BR-009-08, BR-009-12 / SPEC-002 BR-002-24, BR-002-26: the real SUPPORT_REQUEST_SOURCE. It
// answers, FRESH on every call (AR-13: never cached), what a support access grant needs to know of a
// request: whose it is, whether it is open and whether the requester's permission is in force. A grant
// is refused the moment a request is closed or its permission withdrawn, because SupportGrantService
// asks again on every read.
//
// Bound in AccessModule ONLY (access/access.module.ts, test/structural/access-source-bindings.spec.ts),
// through the light SupportRequestsStoreModule: nothing but the model and the repository, so the
// access module imports no auth and no admin code (no cycle) and `npm run grant-admin`, which builds
// AccessModule alone, reads the same implementation.
import { Injectable } from '@nestjs/common';
import type {
  SupportRequestForGrant,
  SupportRequestSource,
} from '../access/sources/support-request.source.js';
import { isDataAccessAllowed } from './domain/support-request.js';
import { SupportRequestsRepository } from './support-requests.repository.js';

@Injectable()
export class SupportRequestsSource implements SupportRequestSource {
  constructor(private readonly requests: SupportRequestsRepository) {}

  async findForGrant(supportRequestId: string): Promise<SupportRequestForGrant | null> {
    const request = await this.requests.findByIdAcrossAccounts(supportRequestId);
    if (!request) return null; // a malformed id is the same null as a missing one
    return {
      id: request._id.toHexString(),
      requesterUserId: request.userId.toHexString(),
      open: request.status === 'open',
      dataAccessAllowed: isDataAccessAllowed(request),
    };
  }
}
