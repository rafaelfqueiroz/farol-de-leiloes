// SPEC-009 BR-009-07, BR-009-10: the outbox of the support emails. A request owes two emails (the
// confirmation to the requester and the notice to the support team). `deliverNow` tries them when the
// request is made; `processDue` (the job, every minute) takes whatever is still owed. Both go through
// the SAME claim (`claimDeliveryByJob`), one conditional update that gives the request to ONE sender at
// a time, so the request's own first attempt and a job run, or two job runs on two replicas, never
// send the same mail twice at the same moment.
//
// What SMTP cannot give is exactly-once: a crash between "the mail left" and "the mail is marked sent"
// makes the next round send that one again. The confirmation carries a Message-ID derived from the
// request (EmailService), so a provider or a mail client can drop the repeat; the notice repeated to
// the team is harmless. A failure of any kind never fails the request that owes the mail (BR-009-07):
// it is stored, its protocol shown, and the delivery is retried with a growing delay up to
// MAX_MAIL_ATTEMPTS rounds (domain/mail-outbox.ts).
//
// SC-15 / AR-46: nothing the requester typed, no name and no address is ever logged; only request ids,
// counts and stable error codes.
import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Clock } from '../common/clock/clock.js';
import { jobErrorCode } from '../common/services/job-error-code.js';
import type { Env } from '../config/env.js';
import { EmailService } from '../email/email.service.js';
import { isAccountActive } from '../users/user-account.js';
import { UsersService } from '../users/users.service.js';
import {
  isLeaseOver,
  MAIL_CLAIM_LEASE_MS,
  MAIL_INLINE_BUDGET_MS,
  MAIL_SEND_TIMEOUT_MS,
  type MailKind,
  mailDecision,
  nextMailAttempt,
  pendingMails,
} from './domain/mail-outbox.js';
import {
  type SupportRequestRecord,
  SupportRequestsRepository,
} from './support-requests.repository.js';
import { orTimeout, TIMED_OUT, within } from './with-timeout.js';

/** What one delivery round of one request came to. */
export interface DeliveryOutcome {
  /** The request's confirmation is delivered (now or before). */
  readonly confirmationSent: boolean;
  /** Emails that left in this round. */
  readonly sent: number;
  /** A mail failed and a retry is scheduled. */
  readonly retryScheduled: boolean;
  /** The retries ran out. */
  readonly gaveUp: boolean;
}

/** What one job run came to. */
export interface DueRunOutcome {
  readonly requests: number;
  readonly sent: number;
  readonly retried: number;
  readonly gaveUp: number;
}

/** How many requests one job run takes; the next run takes the rest. */
export const DUE_REQUESTS_PER_RUN = 25;

@Injectable()
export class SupportMailService {
  private readonly logger = new Logger(SupportMailService.name);

  constructor(
    private readonly requests: SupportRequestsRepository,
    private readonly users: UsersService,
    private readonly email: EmailService,
    private readonly config: ConfigService<Env, true>,
    private readonly clock: Clock, // AR-24
  ) {}

  /**
   * BR-009-07: tries the request's emails now, inline with the request that created it, but never holds
   * the requester on SMTP: after MAIL_INLINE_BUDGET_MS it answers `confirmationSent: false` and the
   * delivery goes on in the background (it keeps its claim; if it dies the lease ends and the job
   * takes over). Never throws: a failure leaves the request owing the mail (its retry is already
   * scheduled by the outbox), and the answer says whether the confirmation is out.
   */
  async deliverNow(requestId: string): Promise<{ confirmationSent: boolean }> {
    try {
      const claimed = await this.claim(requestId);
      // Another sender already holds it (the job took it in the same second): its outcome is its own.
      if (!claimed) return { confirmationSent: false };
      const delivery = this.deliver(claimed.request, claimed.token).then(
        (outcome) => outcome.confirmationSent,
        (error: unknown) => {
          this.logger.error(
            `Support mail delivery failed for request ${requestId}: ${jobErrorCode(error)}`,
          );
          return false;
        },
      );
      const confirmationSent = await within(delivery, MAIL_INLINE_BUDGET_MS);
      return { confirmationSent: confirmationSent === TIMED_OUT ? false : confirmationSent };
    } catch (error) {
      this.logger.error(
        `Support mail delivery failed for request ${requestId}: ${jobErrorCode(error)}`,
      );
      return { confirmationSent: false };
    }
  }

  /**
   * The job: takes the due requests one at a time, up to `limit`, and delivers each. A fault in one
   * request's delivery is logged and the run goes on with the next (the failed one keeps its claim until
   * its lease ends, so the run cannot take it again).
   */
  async processDue(limit: number = DUE_REQUESTS_PER_RUN): Promise<DueRunOutcome> {
    let requests = 0;
    let sent = 0;
    let retried = 0;
    let gaveUp = 0;
    while (requests < limit) {
      const claimed = await this.claim(undefined);
      if (!claimed) break;
      requests += 1;
      try {
        const outcome = await this.deliver(claimed.request, claimed.token);
        sent += outcome.sent;
        if (outcome.retryScheduled) retried += 1;
        if (outcome.gaveUp) gaveUp += 1;
      } catch (error) {
        this.logger.error(
          `Support mail delivery failed for request ${claimed.request._id.toHexString()}: ${jobErrorCode(error)}`,
        );
      }
    }
    return { requests, sent, retried, gaveUp };
  }

  private async claim(
    requestId: string | undefined,
  ): Promise<{ request: SupportRequestRecord; token: string } | null> {
    const token = randomUUID();
    const now = this.clock.now();
    const request = await this.requests.claimDeliveryByJob(
      requestId,
      token,
      now,
      new Date(now.getTime() + MAIL_CLAIM_LEASE_MS),
    );
    return request ? { request, token } : null;
  }

  /**
   * One round over a request this worker holds: every owed mail is sent, skipped or failed, then the
   * claim is released. The claim is a lease (MAIL_CLAIM_LEASE_MS): before each mail the worker checks
   * the lease is not over and after each one that its mark was recorded (a mark that matches nothing
   * means another worker holds the request now), and in either case it stops and sends nothing more, so
   * a worker that stalled never sends over the one that took its place. A fault outside a send (the
   * account lookup) counts as a failed round like a send's.
   */
  private async deliver(request: SupportRequestRecord, token: string): Promise<DeliveryOutcome> {
    const id = request._id.toHexString();
    let failed = false;
    let lost = false;
    let sent = 0;
    let confirmationSent = request.confirmationSentAt !== undefined;

    // BR-009-07: the CURRENT name and address, read now, never a copy taken when the request was made.
    let account: Awaited<ReturnType<UsersService['findById']>> = null;
    let looked = false;
    try {
      account = await this.users.findById(request.userId.toHexString());
      looked = true;
    } catch (error) {
      failed = true;
      this.logger.warn(
        `Support mail account lookup failed for request ${id}: ${jobErrorCode(error)}`,
      );
    }
    // A document with no status is an active account (user-account.ts).
    const status = account ? (isAccountActive(account) ? 'active' : account.status) : null;

    for (const kind of looked ? pendingMails(request) : []) {
      if (isLeaseOver(request.mailClaimUntil, this.clock.now())) {
        lost = true;
        break;
      }
      try {
        if (!account || mailDecision(kind, status) === 'skip') {
          const recorded = await this.requests.markMailSettledByJob(
            id,
            token,
            kind,
            'skipped',
            this.clock.now(),
          );
          if (!recorded) lost = true;
        } else {
          await orTimeout(
            this.send(kind, request, { name: account.name, email: account.email }),
            MAIL_SEND_TIMEOUT_MS,
          );
          sent += 1;
          if (kind === 'confirmation') confirmationSent = true; // it left, whatever happens to the mark
          const recorded = await this.requests.markMailSettledByJob(
            id,
            token,
            kind,
            'sent',
            this.clock.now(),
          );
          if (!recorded) lost = true;
        }
      } catch (error) {
        failed = true;
        this.logger.warn(`Support mail ${kind} failed for request ${id}: ${jobErrorCode(error)}`);
        // The lease may have ended while the send hung: do not go on to the next mail on a claim that
        // is probably someone else's now (the check at the top of the loop sees it).
      }
      if (lost) break;
    }

    const now = this.clock.now();
    if (failed) {
      const failedRounds = request.mailAttempts + 1;
      const next = nextMailAttempt(failedRounds, now);
      if (next.giveUp) {
        await this.requests.releaseClaimByJob(id, token, {
          kind: 'give_up',
          failedRounds,
          gaveUpAt: now,
        });
        this.logger.error(
          `Support mail for request ${id} gave up after ${failedRounds} failed rounds`,
        );
        return { confirmationSent, sent, retryScheduled: false, gaveUp: true };
      }
      await this.requests.releaseClaimByJob(id, token, {
        kind: 'retry',
        failedRounds,
        retryAt: next.at,
      });
      return { confirmationSent, sent, retryScheduled: true, gaveUp: false };
    }
    if (lost) {
      // Not a failure: hand what is left to the next run at once. Token-fenced: if another worker holds
      // the request this matches nothing and changes nothing of its.
      await this.requests.releaseClaimByJob(id, token, {
        kind: 'retry',
        failedRounds: request.mailAttempts,
        retryAt: now,
      });
      return { confirmationSent, sent, retryScheduled: false, gaveUp: false };
    }
    await this.requests.releaseClaimByJob(id, token, { kind: 'done' });
    return { confirmationSent, sent, retryScheduled: false, gaveUp: false };
  }

  private send(
    kind: MailKind,
    request: SupportRequestRecord,
    requester: { name: string; email: string },
  ): Promise<void> {
    if (kind === 'confirmation') {
      return this.email.sendSupportConfirmationEmail({
        to: requester.email,
        requestId: request._id.toHexString(),
        protocol: request.protocol,
        subject: request.subject,
        message: request.message,
      });
    }
    return this.email.sendSupportNoticeEmail({
      to: this.config.get('SUPPORT_EMAIL', { infer: true }),
      protocol: request.protocol,
      requesterName: requester.name,
      requesterEmail: requester.email,
      subject: request.subject,
      message: request.message,
    });
  }
}
