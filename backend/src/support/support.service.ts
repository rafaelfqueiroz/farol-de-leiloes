// SPEC-009 BR-009-04..BR-009-09 (requester side): a support request is a stored record with a
// protocol, a status and the requester's data-access permission, not a mail. Whose request it is comes
// from the AccessContext of the session (BR-002-11), never from an argument; another account's request
// is the same NOT_FOUND as a missing one (AR-14).
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AccessContext } from '../access/access-context.js';
import { SupportGrantService } from '../admin-access/support-grant.service.js';
import { brasiliaCalendarDate } from '../common/clock/brasilia-time.js';
import { Clock } from '../common/clock/clock.js';
import { DomainError } from '../common/errors/domain-error.js';
import { type PageRequest, type Paginated, paginated } from '../common/pagination/paginated.js';
import type { Env } from '../config/env.js';
import { formatProtocol, protocolCounterKey } from './domain/protocol.js';
import { withdrawalOutcome } from './domain/support-request.js';
import type { CreateSupportRequestDto } from './dto/create-support-request.dto.js';
import { SupportCountersRepository } from './support-counters.repository.js';
import { SupportMailService } from './support-mail.service.js';
import {
  type SupportRequestRecord,
  SupportRequestsRepository,
} from './support-requests.repository.js';

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private readonly requests: SupportRequestsRepository,
    private readonly counters: SupportCountersRepository,
    private readonly mail: SupportMailService,
    private readonly grants: SupportGrantService,
    private readonly config: ConfigService<Env, true>,
    private readonly clock: Clock, // AR-24
  ) {}

  /** BR-009-03: the support team's address, as configured (SUPPORT_EMAIL, no default). */
  contactEmail(): string {
    return this.config.get('SUPPORT_EMAIL', { infer: true });
  }

  /**
   * BR-009-04, BR-009-06, BR-009-07: stores the request with the next protocol, then tries its two
   * emails at once. The request is stored whatever the mail does; `confirmationSent` says whether
   * the confirmation is out already (false is not an error: the outbox retries).
   *
   * The protocol's number comes from an atomic per-year counter (the year in Brasília time, AR-23),
   * allocated BEFORE the insert; an insert that then fails leaves a gap in the sequence, which is
   * harmless: a protocol only has to be unique (BR-009-06).
   */
  async create(
    ctx: AccessContext,
    dto: CreateSupportRequestDto,
  ): Promise<{ request: SupportRequestRecord; confirmationSent: boolean }> {
    const now = this.clock.now();
    const year = Number(brasiliaCalendarDate(now).slice(0, 4));
    const sequence = await this.counters.next(protocolCounterKey(year));
    const request = await this.requests.createFor(ctx, {
      protocol: formatProtocol(year, sequence),
      subject: dto.subject,
      message: dto.message,
      allowDataAccess: dto.allowDataAccess,
      openedAt: now,
    });
    const { confirmationSent } = await this.mail.deliverNow(request._id.toHexString());
    // SC-15: the id and a flag only; never the subject, the message, a name or an address.
    this.logger.log(
      `Support request submitted: ${request._id.toHexString()} (confirmationSent ${String(confirmationSent)})`,
    );
    return { request, confirmationSent };
  }

  /** BR-009-09: the account's own requests, newest first (AR-35). */
  async listMine(ctx: AccessContext, page: PageRequest): Promise<Paginated<SupportRequestRecord>> {
    const { items, total } = await this.requests.pageOf(ctx, page);
    return paginated(items, total, page);
  }

  /** BR-009-09: one of the account's own requests; another account's or a missing one is NOT_FOUND (AR-14). */
  async getMine(ctx: AccessContext, id: string): Promise<SupportRequestRecord> {
    const request = await this.requests.findById(ctx, id);
    if (!request) throw new DomainError('NOT_FOUND');
    return request;
  }

  /**
   * BR-009-08, BR-002-26: the requester withdraws the permission of an OPEN request. A request that is
   * closed answers SUPPORT_REQUEST_CLOSED; one with no permission in force (never given, or already
   * withdrawn) answers its unchanged state, so asking twice is not an error.
   *
   * The permission is recorded FIRST and the open grant ended after, which is the safe order: from the
   * first write on, `contextForRead` refuses (it re-reads the request on every read), so a grant opened
   * in between is refused on its first read. The end of any grant is also called when there was
   * nothing to withdraw, so a grant a race left open is closed here too.
   */
  async withdrawDataAccess(ctx: AccessContext, id: string): Promise<SupportRequestRecord> {
    const request = await this.getMine(ctx, id);
    const outcome = withdrawalOutcome(request);
    if (outcome === 'closed') throw new DomainError('SUPPORT_REQUEST_CLOSED');
    if (outcome === 'withdraw') {
      await this.requests.markDataAccessWithdrawn(ctx, id, this.clock.now());
    }
    await this.grants.endForSupportRequest(id, 'withdrawn');
    return this.getMine(ctx, id);
  }
}
