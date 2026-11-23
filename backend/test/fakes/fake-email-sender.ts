import type { EmailService } from '../../src/email/email.service.js';

type Args<K extends keyof EmailService> = Parameters<EmailService[K]>;

/**
 * The slice of `EmailService` that `AuthService`, the reminders scheduler and the support outbox
 * call, with the real parameter types (TS-03).
 */
interface EmailPort {
  sendVerificationEmail(...args: Args<'sendVerificationEmail'>): Promise<void>;
  sendPasswordResetEmail(...args: Args<'sendPasswordResetEmail'>): Promise<void>;
  sendReminderEmail(...args: Args<'sendReminderEmail'>): Promise<void>;
  sendSupportConfirmationEmail(...args: Args<'sendSupportConfirmationEmail'>): Promise<void>;
  sendSupportNoticeEmail(...args: Args<'sendSupportNoticeEmail'>): Promise<void>;
  sendPaymentFailedEmail(...args: Args<'sendPaymentFailedEmail'>): Promise<void>;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
}

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * TS-03 / TS-07: records the emails instead of sending them; nothing reaches SMTP. Inject it
 * with `fake as unknown as EmailService`.
 */
export class FakeEmailSender implements EmailPort {
  readonly verificationEmails: Array<{ email: string; token: string; name: string }> = [];
  readonly passwordResetEmails: Array<{ email: string; token: string; name: string }> = [];
  readonly reminderEmails: Array<{ email: string; payload: Args<'sendReminderEmail'>[1] }> = [];
  /** SPEC-009 BR-009-07: the confirmations delivered to requesters. */
  readonly supportConfirmations: Array<Args<'sendSupportConfirmationEmail'>[0]> = [];
  /** SPEC-009 BR-009-10: the notices delivered to the support mailbox. */
  readonly supportNotices: Array<Args<'sendSupportNoticeEmail'>[0]> = [];
  readonly paymentFailedEmails: Array<{ email: string; name: string | undefined }> = [];
  /** Makes the sends to these addresses fail, as an unreachable mail server would. */
  readonly failFor = new Set<string>();
  /** Makes every support email (confirmation and notice) fail, as an SMTP server that is down would. */
  supportMailDown = false;
  private heldSupportSends: Array<Deferred> = [];
  /** How many support sends are waiting on a `holdNextSupportSend()`. */
  waitingSupportSends = 0;

  /**
   * Makes the NEXT support send (confirmation or notice) wait until the test says how it ends, like an
   * SMTP server that stalls: `succeed()` records it as delivered, `fail()` rejects it (the transport's
   * timeout). Later sends are not held.
   */
  holdNextSupportSend(): { succeed(): void; fail(): void } {
    const held = deferred();
    this.heldSupportSends.push(held);
    return { succeed: () => held.resolve(), fail: () => held.reject(new Error('smtp timeout')) };
  }

  private async passSupportGate(to: string): Promise<void> {
    const held = this.heldSupportSends.shift();
    if (held) {
      this.waitingSupportSends += 1;
      try {
        await held.promise;
      } finally {
        this.waitingSupportSends -= 1;
      }
    }
    if (this.supportMailDown || this.failFor.has(to)) throw new Error('mail server unreachable');
  }

  async sendVerificationEmail(email: string, token: string, name: string): Promise<void> {
    this.verificationEmails.push({ email, token, name });
  }

  async sendPasswordResetEmail(email: string, token: string, name: string): Promise<void> {
    this.passwordResetEmails.push({ email, token, name });
  }

  async sendReminderEmail(...[email, payload]: Args<'sendReminderEmail'>): Promise<void> {
    this.reminderEmails.push({ email, payload });
  }

  async sendPaymentFailedEmail(...[email, name]: Args<'sendPaymentFailedEmail'>): Promise<void> {
    if (this.failFor.has(email)) throw new Error('mail server unreachable');
    this.paymentFailedEmails.push({ email, name });
  }

  async sendSupportConfirmationEmail(
    ...[mail]: Args<'sendSupportConfirmationEmail'>
  ): Promise<void> {
    await this.passSupportGate(mail.to);
    this.supportConfirmations.push(mail);
  }

  async sendSupportNoticeEmail(...[mail]: Args<'sendSupportNoticeEmail'>): Promise<void> {
    await this.passSupportGate(mail.to);
    this.supportNotices.push(mail);
  }
}
