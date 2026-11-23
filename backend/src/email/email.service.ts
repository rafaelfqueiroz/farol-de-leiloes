import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import * as nodemailer from 'nodemailer';
import {
  getVerificationEmailTemplate,
  getPasswordResetEmailTemplate,
} from './templates/verification.template.js';
import { getPaymentFailedEmailTemplate } from './templates/payment-failed.template.js';
import {
  getSupportConfirmationEmail,
  getSupportNoticeEmail,
  type SupportConfirmationInput,
  type SupportNoticeInput,
} from './templates/support.template.js';
import {
  getAuctionReminderEmailTemplate,
  ReminderEmailPayload,
} from '../reminders/templates/reminder.template.js';

/**
 * SPEC-009 BR-009-07 (security review of #186): an SMTP server that accepts the connection and then
 * stalls must not hold a send for minutes (nodemailer's defaults are 2 minutes to connect, 30 seconds for
 * the greeting and 10 minutes of socket silence). These are well inside the support outbox's claim lease
 * of 2 minutes (domain/mail-outbox.ts), so one send is over, one way or the other, before another worker
 * can take the request over.
 */
export const SMTP_TIMEOUTS = {
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 15_000,
} as const;

/** The nodemailer transport options for the configured SMTP account, with the bounded timeouts. */
export function smtpTransportOptions(account: {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
}) {
  return {
    host: account.host,
    port: account.port,
    secure: account.secure,
    auth: { user: account.user, pass: account.pass },
    ...SMTP_TIMEOUTS,
  };
}

/** SPEC-009 BR-009-07: what the confirmation to a requester is made of (`requestId` keys its Message-ID). */
export interface SupportConfirmationMail extends SupportConfirmationInput {
  readonly to: string;
  readonly requestId: string;
}

/** SPEC-009 BR-009-10: what the notice to the support team is made of. */
export interface SupportNoticeMail extends SupportNoticeInput {
  readonly to: string;
}

/**
 * BR-009-07: the Message-ID of the confirmation of a request: stable, so a duplicate send of the
 * same confirmation carries the same id. Its domain is the sender's (EMAIL_FROM, with or without a
 * display name), `localhost` when none can be read.
 */
export function supportConfirmationMessageId(requestId: string, emailFrom: string): string {
  const domain = /@([^\s<>@]+)>?\s*$/.exec(emailFrom)?.[1] ?? 'localhost';
  return `<support-confirmation-${requestId}@${domain}>`;
}

// SC-15 / SC-16 / AR-46: no recipient address, name, message content or token link is logged,
// including when SMTP is unavailable in development.
@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private readonly logger = new Logger(EmailService.name);

  constructor(private configService: ConfigService<Env, true>) {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const host = this.configService.get('SMTP_HOST', { infer: true });
    const port = this.configService.get('SMTP_PORT', { infer: true });
    const user = this.configService.get('SMTP_USER', { infer: true });
    const pass = this.configService.get('SMTP_PASS', { infer: true });

    if (host && port && user && pass) {
      this.transporter = nodemailer.createTransport(
        smtpTransportOptions({
          host,
          port,
          secure: this.configService.get('SMTP_SECURE', { infer: true }),
          user,
          pass,
        }),
      );
      this.logger.log('Email transporter initialized');
    } else {
      this.logger.warn('SMTP configuration not found. Emails are not sent (development mode).');
    }
  }

  // SC-15 / SC-16: the fallback reports only the email kind; token URLs remain secret everywhere.
  private logSimulatedEmail(kind: string): void {
    this.logger.log(`${kind} simulated (SMTP not configured)`);
  }

  async sendVerificationEmail(email: string, token: string, name: string): Promise<void> {
    const frontendUrl = this.configService.get('FRONTEND_URL', { infer: true });
    const verificationUrl = `${frontendUrl}/verify-email/${token}`;

    if (!this.transporter) {
      this.logSimulatedEmail('Verification email');
      return;
    }

    const emailFrom = this.configService.get('EMAIL_FROM', { infer: true });

    await this.transporter.sendMail({
      from: emailFrom,
      to: email,
      subject: 'Verifique seu email - Farol dos Leiloes',
      html: getVerificationEmailTemplate(name, verificationUrl),
    });

    this.logger.log('Verification email sent');
  }

  async sendPasswordResetEmail(email: string, token: string, name: string): Promise<void> {
    const frontendUrl = this.configService.get('FRONTEND_URL', { infer: true });
    const resetUrl = `${frontendUrl}/reset-password/${token}`;

    if (!this.transporter) {
      this.logSimulatedEmail('Password reset email');
      return;
    }

    const emailFrom = this.configService.get('EMAIL_FROM', { infer: true });

    await this.transporter.sendMail({
      from: emailFrom,
      to: email,
      subject: 'Redefinir Senha - Farol dos Leiloes',
      html: getPasswordResetEmailTemplate(name, resetUrl),
    });

    this.logger.log('Password reset email sent');
  }

  /**
   * SPEC-009 BR-009-07: the confirmation to the requester, at the account's current address. The
   * Subject is fixed text plus the protocol, never the requester's words (no header injection, and
   * nothing typed by a person in a header). The Message-ID is stable per request, so a mail
   * provider or client can drop the rare duplicate a crash between "sent" and "marked" can cause.
   * Throws when the send fails; the caller (the outbox) retries. SC-15: nothing is logged but the kind.
   */
  async sendSupportConfirmationEmail(input: SupportConfirmationMail): Promise<void> {
    if (!this.transporter) {
      this.logSimulatedEmail('Support confirmation email');
      return;
    }
    const emailFrom = this.configService.get('EMAIL_FROM', { infer: true });
    const { html, text } = getSupportConfirmationEmail(input);

    await this.transporter.sendMail({
      from: emailFrom,
      to: input.to,
      messageId: supportConfirmationMessageId(input.requestId, emailFrom),
      subject: `Recebemos sua solicitação de suporte ${input.protocol} - Farol dos Leilões`,
      html,
      text,
    });

    this.logger.log('Support confirmation email sent');
  }

  /**
   * SPEC-009 BR-009-10: the notice to the support team's mailbox (`to`, from SUPPORT_EMAIL). Reply-To
   * is the requester as a structured address, so answering the notice answers the person. The
   * Subject is fixed text plus the protocol (see above).
   */
  async sendSupportNoticeEmail(input: SupportNoticeMail): Promise<void> {
    if (!this.transporter) {
      this.logSimulatedEmail('Support notice email');
      return;
    }
    const emailFrom = this.configService.get('EMAIL_FROM', { infer: true });
    const { html, text } = getSupportNoticeEmail(input);

    await this.transporter.sendMail({
      from: emailFrom,
      to: input.to,
      replyTo: { name: '', address: input.requesterEmail },
      subject: `[Suporte] Nova solicitação ${input.protocol}`,
      html,
      text,
    });

    this.logger.log('Support notice email sent'); // SC-15: no recipient, no content
  }

  async sendReminderEmail(email: string, payload: ReminderEmailPayload): Promise<void> {
    if (!this.transporter) {
      this.logger.log(
        `Reminder email simulated (development mode, SMTP not configured): auction ${payload.auctionCode}`,
      );
      return;
    }

    const emailFrom = this.configService.get('EMAIL_FROM', { infer: true });

    await this.transporter.sendMail({
      from: emailFrom,
      to: email,
      subject: `Lembrete: leilão ${payload.auctionCode} - Farol dos Leilões`,
      html: getAuctionReminderEmailTemplate(payload),
    });

    this.logger.log('Reminder email sent');
  }

  /**
   * SPEC-012 BR-012-20: tells a member of an office that a renewal payment failed, with the link
   * to update the payment method. SC-15: no address and no name is logged.
   */
  async sendPaymentFailedEmail(email: string, name?: string): Promise<void> {
    if (!this.transporter) {
      this.logSimulatedEmail('Payment failed email');
      return;
    }

    const frontendUrl = this.configService.get('FRONTEND_URL', { infer: true });
    const emailFrom = this.configService.get('EMAIL_FROM', { infer: true });

    await this.transporter.sendMail({
      from: emailFrom,
      to: email,
      subject: 'Falha no pagamento do plano - Farol dos Leilões',
      html: getPaymentFailedEmailTemplate(name, `${frontendUrl}/office/plan`),
    });

    this.logger.log('Payment failed email sent');
  }
}
