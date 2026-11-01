import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import {
  getVerificationEmailTemplate,
  getPasswordResetEmailTemplate,
} from './templates/verification.template';
import {
  getAuctionReminderEmailTemplate,
  ReminderEmailPayload,
} from '../reminders/templates/reminder.template';

@Injectable()
export class EmailService {
  private transporter: nodemailer.Transporter | null = null;
  private readonly logger = new Logger(EmailService.name);

  constructor(private configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter(): void {
    const host = this.configService.get<string>('SMTP_HOST');
    const port = this.configService.get<number>('SMTP_PORT');
    const user = this.configService.get<string>('SMTP_USER');
    const pass = this.configService.get<string>('SMTP_PASS');

    if (host && port && user && pass) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: this.configService.get<string>('SMTP_SECURE') === 'true',
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
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    const verificationUrl = `${frontendUrl}/verify-email/${token}`;

    if (!this.transporter) {
      this.logger.log('='.repeat(60));
      this.logger.log('VERIFICATION EMAIL (Development Mode)');
      this.logger.log(`To: ${email}`);
      this.logger.log(`Name: ${name}`);
      this.logger.log(`Verification URL: ${verificationUrl}`);
      this.logger.log('='.repeat(60));
      return;
    }

    const emailFrom = this.configService.get<string>('EMAIL_FROM') || 'noreply@faroldosleiloes.com';

    await this.transporter.sendMail({
      from: emailFrom,
      to: email,
      subject: 'Verifique seu email - Farol dos Leiloes',
      html: getVerificationEmailTemplate(name, verificationUrl),
    });

    this.logger.log(`Verification email sent to ${email}`);
  }

  async sendPasswordResetEmail(email: string, token: string, name: string): Promise<void> {
    const frontendUrl = this.configService.get<string>('FRONTEND_URL');
    const resetUrl = `${frontendUrl}/reset-password/${token}`;

    if (!this.transporter) {
      this.logger.log('='.repeat(60));
      this.logger.log('PASSWORD RESET EMAIL (Development Mode)');
      this.logger.log(`To: ${email}`);
      this.logger.log(`Name: ${name}`);
      this.logger.log(`Reset URL: ${resetUrl}`);
      this.logger.log('='.repeat(60));
      return;
    }

    const emailFrom = this.configService.get<string>('EMAIL_FROM') || 'noreply@faroldosleiloes.com';

    await this.transporter.sendMail({
      from: emailFrom,
      to: email,
      subject: 'Redefinir Senha - Farol dos Leiloes',
      html: getPasswordResetEmailTemplate(name, resetUrl),
    });

    this.logger.log(`Password reset email sent to ${email}`);
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
      this.logger.log(`From User: ${userName} (${userEmail})`);
      this.logger.log(`Title: ${title}`);
      this.logger.log(`Description: ${description}`);
      this.logger.log('='.repeat(60));
      return;
    }

    const emailFrom = this.configService.get<string>('EMAIL_FROM') || 'noreply@faroldosleiloes.com';

    await this.transporter.sendMail({
      from: emailFrom,
      to,
      replyTo: userEmail,
      subject,
      html,
    });

    this.logger.log(`Support email sent to ${to} from ${userEmail}`);
  }

  async sendReminderEmail(email: string, payload: ReminderEmailPayload): Promise<void> {
    if (!this.transporter) {
      this.logger.log('='.repeat(60));
      this.logger.log('AUCTION REMINDER EMAIL (Development Mode)');
      this.logger.log(`To: ${email}`);
      this.logger.log(`User: ${payload.userName}`);
      this.logger.log(`Auction: ${payload.auctionTitle || payload.auctionCode}`);
      this.logger.log(`Location: ${payload.auctionCity}, ${payload.auctionState}`);
      this.logger.log(`Description: ${payload.description ?? 'N/A'}`);
      this.logger.log('='.repeat(60));
      return;
    }

    const emailFrom = this.configService.get<string>('EMAIL_FROM') || 'noreply@faroldosleiloes.com';

    await this.transporter.sendMail({
      from: emailFrom,
      to: email,
      subject: `Lembrete: Leilao ${payload.auctionCode} - Farol dos Leiloes`,
      html: getAuctionReminderEmailTemplate(payload),
    });

    this.logger.log(`Reminder email sent to ${email}`);
  }
}
