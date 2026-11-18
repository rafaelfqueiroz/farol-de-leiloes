import type { EmailService } from '../../src/email/email.service.js';

type EmailPort = Pick<
  EmailService,
  | 'sendVerificationEmail'
  | 'sendPasswordResetEmail'
  | 'sendSupportEmail'
  | 'sendReminderEmail'
  | 'sendPaymentFailedEmail'
>;

export type RecordedEmail = { kind: keyof EmailPort; to: string };

/**
 * TS-22 / TS-07: the E2E stack's email sender. It implements every method of EmailService
 * against the real signatures (TS-03: a change to the service breaks this at compile time) and records
 * the kind and recipient in memory; nothing reaches SMTP. A later journey (sign-up and confirm,
 * SPEC-001) can expose the recorded tokens through a stack-only route.
 */
export class E2eEmailSender implements EmailPort {
  readonly sent: RecordedEmail[] = [];

  // Only the recipient is kept; a method may take fewer parameters than the port declares.
  async sendVerificationEmail(email: string): Promise<void> {
    this.sent.push({ kind: 'sendVerificationEmail', to: email });
  }

  async sendPasswordResetEmail(email: string): Promise<void> {
    this.sent.push({ kind: 'sendPasswordResetEmail', to: email });
  }

  async sendSupportEmail(to: string): Promise<void> {
    this.sent.push({ kind: 'sendSupportEmail', to });
  }

  async sendReminderEmail(email: string): Promise<void> {
    this.sent.push({ kind: 'sendReminderEmail', to: email });
  }

  async sendPaymentFailedEmail(email: string): Promise<void> {
    this.sent.push({ kind: 'sendPaymentFailedEmail', to: email });
  }
}
