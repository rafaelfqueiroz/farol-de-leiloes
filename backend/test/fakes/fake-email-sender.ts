import type { EmailService } from '../../src/email/email.service.js';

type Args<K extends keyof EmailService> = Parameters<EmailService[K]>;

/**
 * The slice of `EmailService` that `AuthService`, the reminders scheduler and `SupportService`
 * call, with the real parameter types (TS-03).
 */
interface EmailPort {
  sendVerificationEmail(...args: Args<'sendVerificationEmail'>): Promise<void>;
  sendPasswordResetEmail(...args: Args<'sendPasswordResetEmail'>): Promise<void>;
  sendReminderEmail(...args: Args<'sendReminderEmail'>): Promise<void>;
  sendSupportEmail(...args: Args<'sendSupportEmail'>): Promise<void>;
  sendPaymentFailedEmail(...args: Args<'sendPaymentFailedEmail'>): Promise<void>;
  sendImportAlertEmail(...args: Args<'sendImportAlertEmail'>): Promise<void>;
}

/**
 * TS-03 / TS-07: records the emails instead of sending them; nothing reaches SMTP. Inject it
 * with `fake as unknown as EmailService`.
 */
export class FakeEmailSender implements EmailPort {
  readonly verificationEmails: Array<{ email: string; token: string; name: string }> = [];
  readonly passwordResetEmails: Array<{ email: string; token: string; name: string }> = [];
  readonly reminderEmails: Array<{ email: string; payload: Args<'sendReminderEmail'>[1] }> = [];
  readonly supportEmails: Array<{ to: string; title: string }> = [];
  readonly paymentFailedEmails: Array<{ email: string; name: string | undefined }> = [];
  readonly importAlertEmails: Array<{ email: string; alert: Args<'sendImportAlertEmail'>[1] }> = [];
  /** Makes the sends to these addresses fail, as an unreachable mail server would. */
  readonly failFor = new Set<string>();
  /** Makes every import alert send fail (the mail server is down). */
  failAll = false;

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

  async sendImportAlertEmail(...[email, alert]: Args<'sendImportAlertEmail'>): Promise<void> {
    if (this.failAll || this.failFor.has(email)) throw new Error('mail server unreachable');
    this.importAlertEmails.push({ email, alert });
  }

  async sendSupportEmail(...[to, , , title]: Args<'sendSupportEmail'>): Promise<void> {
    this.supportEmails.push({ to, title });
  }
}
