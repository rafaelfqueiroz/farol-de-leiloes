import type { EmailService } from '../../src/email/email.service.js';

type Args<K extends keyof EmailService> = Parameters<EmailService[K]>;

/**
 * The slice of `EmailService` that `AuthService` and the reminders scheduler call, with the real
 * parameter types (TS-03).
 */
interface EmailPort {
  sendVerificationEmail(...args: Args<'sendVerificationEmail'>): Promise<void>;
  sendPasswordResetEmail(...args: Args<'sendPasswordResetEmail'>): Promise<void>;
  sendReminderEmail(...args: Args<'sendReminderEmail'>): Promise<void>;
}

/**
 * TS-03 / TS-07: records the emails instead of sending them; nothing reaches SMTP. Inject it
 * with `fake as unknown as EmailService`.
 */
export class FakeEmailSender implements EmailPort {
  readonly verificationEmails: Array<{ email: string; token: string; name: string }> = [];
  readonly passwordResetEmails: Array<{ email: string; token: string; name: string }> = [];
  readonly reminderEmails: Array<{ email: string; payload: Args<'sendReminderEmail'>[1] }> = [];

  async sendVerificationEmail(email: string, token: string, name: string): Promise<void> {
    this.verificationEmails.push({ email, token, name });
  }

  async sendPasswordResetEmail(email: string, token: string, name: string): Promise<void> {
    this.passwordResetEmails.push({ email, token, name });
  }

  async sendReminderEmail(...[email, payload]: Args<'sendReminderEmail'>): Promise<void> {
    this.reminderEmails.push({ email, payload });
  }
}
