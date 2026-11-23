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
    if (this.supportMailDown || this.failFor.has(mail.to))
      throw new Error('mail server unreachable');
    this.supportConfirmations.push(mail);
  }

  async sendSupportNoticeEmail(...[mail]: Args<'sendSupportNoticeEmail'>): Promise<void> {
    if (this.supportMailDown || this.failFor.has(mail.to))
      throw new Error('mail server unreachable');
    this.supportNotices.push(mail);
  }
}
