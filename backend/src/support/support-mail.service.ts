// SPEC-009 BR-009-07, BR-009-10: the outbox of the support emails. A request owes two emails (the
// confirmation to the requester and the notice to the support team). `deliverNow` tries them when the
// request is made; `processDue` (the job, every minute) takes whatever is still owed. Both go through
// the SAME claim (`claimForDelivery`), one conditional update that gives the request to ONE sender at
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
  MAIL_CLAIM_LEASE_MS,
  type MailKind,
  mailDecision,
  nextMailAttempt,
  pendingMails,
} from './domain/mail-outbox.js';
import {
  type SupportRequestRecord,
  SupportRequestsRepository,
} from './support-requests.repository.js';

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
   * BR-009-07: tries the request's emails now, inline with the request that created it. Never throws:
   * a failure leaves the request owing the mail (its retry is already scheduled by the outbox), and
   * the answer says whether the confirmation is out.
   */
  async deliverNow(requestId: string): Promise<{ confirmationSent: boolean }> {
    try {
      const claimed = await this.claim(requestId);
      // Another sender already holds it (the job took it in the same second): its outcome is its own.
      if (!claimed) return { confirmationSent: false };
      const outcome = await this.deliver(claimed.request, claimed.token);
      return { confirmationSent: outcome.confirmationSent };
    } catch (error) {
      this.logger.error(
        `Support mail delivery failed for request ${requestId}: ${jobErrorCode(error)}`,
      );
      return { confirmationSent: false };
    }
  }

  /** The job: takes the due requests one at a time, up to `limit`, and delivers each. */
  async processDue(limit: number = DUE_REQUESTS_PER_RUN): Promise<DueRunOutcome> {
    let requests = 0;
    let sent = 0;
    let retried = 0;
    let gaveUp = 0;
    while (requests < limit) {
      const claimed = await this.claim(undefined);
      if (!claimed) break;
      requests += 1;
      const outcome = await this.deliver(claimed.request, claimed.token);
      sent += outcome.sent;
      if (outcome.retryScheduled) retried += 1;
      if (outcome.gaveUp) gaveUp += 1;
    }
    return { requests, sent, retried, gaveUp };
  }

  private async claim(
    requestId: string | undefined,
  ): Promise<{ request: SupportRequestRecord; token: string } | null> {
    const token = randomUUID();
    const now = this.clock.now();
    const request = await this.requests.claimForDelivery(
      requestId,
      token,
      now,
      new Date(now.getTime() + MAIL_CLAIM_LEASE_MS),
    );
    return request ? { request, token } : null;
  }

  /** One round over a request this worker holds: every owed mail is sent, skipped or failed, then the claim is released. */
  private async deliver(request: SupportRequestRecord, token: string): Promise<DeliveryOutcome> {
    const id = request._id.toHexString();
    // BR-009-07: the CURRENT name and address, read now, never a copy taken when the request was made.
    const account = await this.users.findById(request.userId.toHexString());
    // A document with no status is an active account (user-account.ts).
    const status = account ? (isAccountActive(account) ? 'active' : account.status) : null;

    let failed = false;
    let sent = 0;
    let confirmationSent = request.confirmationSentAt !== undefined;
    for (const kind of pendingMails(request)) {
      try {
        if (!account || mailDecision(kind, status) === 'skip') {
          await this.requests.markMailSettled(id, token, kind, 'skipped', this.clock.now());
          continue;
        }
        await this.send(kind, request, { name: account.name, email: account.email });
        sent += 1;
        await this.requests.markMailSettled(id, token, kind, 'sent', this.clock.now());
        if (kind === 'confirmation') confirmationSent = true;
      } catch (error) {
        failed = true;
        this.logger.warn(`Support mail ${kind} failed for request ${id}: ${jobErrorCode(error)}`);
      }
    }

    if (!failed) {
      await this.requests.releaseClaim(id, token, { kind: 'done' });
      return { confirmationSent, sent, retryScheduled: false, gaveUp: false };
    }
    const now = this.clock.now();
    const failedRounds = request.mailAttempts + 1;
    const next = nextMailAttempt(failedRounds, now);
    if (next.giveUp) {
      await this.requests.releaseClaim(id, token, { kind: 'give_up', failedRounds, gaveUpAt: now });
      this.logger.error(
        `Support mail for request ${id} gave up after ${failedRounds} failed rounds`,
      );
      return { confirmationSent, sent, retryScheduled: false, gaveUp: true };
    }
    await this.requests.releaseClaim(id, token, { kind: 'retry', failedRounds, retryAt: next.at });
    return { confirmationSent, sent, retryScheduled: true, gaveUp: false };
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
