import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import * as nodemailer from 'nodemailer';
import {
  getVerificationEmailTemplate,
  getPasswordResetEmailTemplate,
} from './templates/verification.template';
import {
  getAuctionReminderEmailTemplate,
  ReminderEmailPayload,
} from '../reminders/templates/reminder.template';

// SC-15: no recipient address, name or message content in any log line below; the development
// fallback logs only what a developer needs to follow the link.
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
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: this.configService.get('SMTP_SECURE', { infer: true }),
        auth: {
          user,
          pass,
        },
      });
      this.logger.log('Email transporter initialized');
    } else {
      this.logger.warn('SMTP configuration not found. Emails will be logged to console.');
    }
  }

  async sendVerificationEmail(email: string, token: string, name: string): Promise<void> {
    const frontendUrl = this.configService.get('FRONTEND_URL', { infer: true });
    const verificationUrl = `${frontendUrl}/verify-email/${token}`;

    if (!this.transporter) {
      this.logger.log('='.repeat(60));
      this.logger.log('VERIFICATION EMAIL (Development Mode)');
      this.logger.log(`Verification URL: ${verificationUrl}`);
      this.logger.log('='.repeat(60));
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
      this.logger.log('='.repeat(60));
      this.logger.log('PASSWORD RESET EMAIL (Development Mode)');
      this.logger.log(`Reset URL: ${resetUrl}`);
      this.logger.log('='.repeat(60));
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

  async sendSupportEmail(
    to: string,
    userEmail: string,
    userName: string,
    title: string,
    description: string,
  ): Promise<void> {
    const subject = `[Suporte] ${title}`;
    const html = `
      <h2>Nova solicitação de suporte</h2>
      <p><strong>Usuário:</strong> ${userName} (${userEmail})</p>
      <p><strong>Título:</strong> ${title}</p>
      <hr />
      <p><strong>Descrição:</strong></p>
      <p>${description.replace(/\n/g, '<br />')}</p>
    `;

    if (!this.transporter) {
      this.logger.log('='.repeat(60));
      this.logger.log('SUPPORT REQUEST EMAIL (Development Mode)');
      this.logger.log(`To: ${to}`);
      this.logger.log('='.repeat(60));
      return;
    }

    const emailFrom = this.configService.get('EMAIL_FROM', { infer: true });

    await this.transporter.sendMail({
      from: emailFrom,
      to,
      replyTo: userEmail,
      subject,
      html,
    });

    this.logger.log(`Support email sent to ${to}`);
  }

  async sendReminderEmail(email: string, payload: ReminderEmailPayload): Promise<void> {
    if (!this.transporter) {
      this.logger.log('='.repeat(60));
      this.logger.log('AUCTION REMINDER EMAIL (Development Mode)');
      this.logger.log(`Auction: ${payload.auctionTitle || payload.auctionCode}`);
      this.logger.log(`Location: ${payload.auctionCity}, ${payload.auctionState}`);
      this.logger.log('='.repeat(60));
      return;
    }

    const emailFrom = this.configService.get('EMAIL_FROM', { infer: true });

    await this.transporter.sendMail({
      from: emailFrom,
      to: email,
      subject: `Lembrete: Leilao ${payload.auctionCode} - Farol dos Leiloes`,
      html: getAuctionReminderEmailTemplate(payload),
    });

    this.logger.log('Reminder email sent');
  }
}
