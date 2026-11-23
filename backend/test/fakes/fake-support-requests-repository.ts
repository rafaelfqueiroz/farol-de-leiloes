// SPEC-009: a hand-written in-memory fake (TS-03) of the part of SupportRequestsRepository the support
// services call, with the same claim semantics as the real one (a request is held by one token until
// its lease ends; every settle and release is conditional on the token). The real conditional updates
// are proven against MongoDB in test/integration/support-requests.spec.ts; this fake lets the service
// specs run without a database.
import { Types } from 'mongoose';
import type { AccessContext } from '../../src/access/access-context.js';
import type { SupportRequestsRepository } from '../../src/support/support-requests.repository.js';
import type { SupportRequestRecord } from '../../src/support/support-requests.repository.js';
import type { MailKind } from '../../src/support/domain/mail-outbox.js';

type Port = Pick<
  SupportRequestsRepository,
  | 'createFor'
  | 'claimDeliveryByJob'
  | 'markMailSettledByJob'
  | 'releaseClaimByJob'
  | 'findByIdAcrossAccounts'
  | 'findById'
  | 'pageOf'
  | 'markDataAccessWithdrawn'
>;

const SETTLED = {
  confirmation: { sent: 'confirmationSentAt', skipped: 'confirmationSkippedAt' },
  team_notice: { sent: 'teamNoticeSentAt', skipped: 'teamNoticeSkippedAt' },
} as const;

export class FakeSupportRequestsRepository implements Port {
  readonly rows: SupportRequestRecord[] = [];

  createFor: Port['createFor'] = (ctx, request) => {
    const createdAt = request.openedAt;
    const row: SupportRequestRecord = {
      _id: new Types.ObjectId(),
      userId: new Types.ObjectId(ctx.accountId),
      protocol: request.protocol,
      subject: request.subject,
      message: request.message,
      allowDataAccess: request.allowDataAccess,
      status: 'open',
      mailAttempts: 0,
      mailNextAttemptAt: request.openedAt,
      createdAt,
      updatedAt: createdAt,
    };
    this.rows.push(row);
    return Promise.resolve({ ...row });
  };

  claimDeliveryByJob: Port['claimDeliveryByJob'] = (id, token, now, until) => {
    const row = this.rows
      .filter(
        (candidate) =>
          (id === undefined || candidate._id.toHexString() === id) &&
          candidate.mailNextAttemptAt !== undefined &&
          candidate.mailNextAttemptAt <= now &&
          (candidate.mailClaimUntil === undefined || candidate.mailClaimUntil <= now),
      )
      .sort(
        (a, b) => (a.mailNextAttemptAt?.getTime() ?? 0) - (b.mailNextAttemptAt?.getTime() ?? 0),
      )[0];
    if (!row) return Promise.resolve(null);
    row.mailClaimToken = token;
    row.mailClaimUntil = until;
    return Promise.resolve({ ...row });
  };

  markMailSettledByJob: Port['markMailSettledByJob'] = (id, token, kind: MailKind, outcome, at) => {
    const row = this.byId(id);
    if (!row || row.mailClaimToken !== token) return Promise.resolve(false);
    row[SETTLED[kind][outcome]] = at;
    return Promise.resolve(true);
  };

  releaseClaimByJob: Port['releaseClaimByJob'] = (id, token, release) => {
    const row = this.byId(id);
    if (!row || row.mailClaimToken !== token) return Promise.resolve(false);
    delete row.mailClaimToken;
    delete row.mailClaimUntil;
    if (release.kind === 'retry') {
      row.mailAttempts = release.failedRounds;
      row.mailNextAttemptAt = release.retryAt;
    } else {
      delete row.mailNextAttemptAt;
      if (release.kind === 'give_up') {
        row.mailAttempts = release.failedRounds;
        row.mailGaveUpAt = release.gaveUpAt;
      }
    }
    return Promise.resolve(true);
  };

  findByIdAcrossAccounts: Port['findByIdAcrossAccounts'] = (id) => {
    const row = this.byId(id);
    return Promise.resolve(row ? { ...row } : null);
  };

  findById: Port['findById'] = (ctx: AccessContext, id: string) => {
    const row = this.byId(id);
    return Promise.resolve(row && row.userId.toHexString() === ctx.accountId ? { ...row } : null);
  };

  pageOf: Port['pageOf'] = (ctx, page) => {
    const mine = this.rows.filter((row) => row.userId.toHexString() === ctx.accountId).reverse();
    const start = (page.page - 1) * page.pageSize;
    return Promise.resolve({
      items: mine.slice(start, start + page.pageSize).map((row) => ({ ...row })),
      total: mine.length,
    });
  };

  markDataAccessWithdrawn: Port['markDataAccessWithdrawn'] = (ctx, id, at) => {
    const row = this.byId(id);
    if (
      !row ||
      row.userId.toHexString() !== ctx.accountId ||
      row.status !== 'open' ||
      !row.allowDataAccess ||
      row.dataAccessWithdrawnAt
    ) {
      return Promise.resolve(false);
    }
    row.dataAccessWithdrawnAt = at;
    return Promise.resolve(true);
  };

  private byId(id: string): SupportRequestRecord | undefined {
    return this.rows.find((row) => row._id.toHexString() === id);
  }
}
