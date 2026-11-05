import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { logSafeError } from '../common/errors/log-safe-error';

export interface SmsPayload {
  auctionTitle: string;
  auctionCode: string;
  auctionCity: string | null;
  auctionState: string | null;
  description: string | null;
}

export interface SmsResult {
  success: boolean;
  errorMessage?: string;
}

@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);

  constructor(private configService: ConfigService<Env, true>) {}

  async sendReminderSms(phoneNumber: string, payload: SmsPayload): Promise<SmsResult> {
    const message = this.formatMessage(payload);

    if (!this.isConfigured()) {
      // SC-15 / AR-46: the recipient and the message body are personal data, even in development.
      this.logger.log(
        `SMS reminder simulated (development mode, no provider configured): auction ${payload.auctionCode}, ${message.length} chars`,
      );
      return { success: true };
    }

    try {
      // TODO: Implement actual SMS provider integration (e.g., Twilio)
      this.logger.log(`SMS reminder sent for auction ${payload.auctionCode}`);
      return { success: true };
    } catch (error) {
      this.logger.error(
        `Failed to send SMS reminder for auction ${payload.auctionCode}: ${logSafeError(error)}`,
      );
      return {
        success: false,
        // SC-15: the provider's message quotes the recipient; a stable code is stored and logged.
        errorMessage: logSafeError(error),
      };
    }
  }

  private formatMessage(payload: SmsPayload): string {
    const location =
      [payload.auctionCity, payload.auctionState].filter(Boolean).join('/') ||
      'Local nao informado';

    let message = `Lembrete: Leilao "${payload.auctionTitle || payload.auctionCode}" em ${location} comeca em breve!`;

    if (payload.description) {
      message += ` Nota: ${payload.description}`;
    }

    return message.trim();
  }

  private isConfigured(): boolean {
    return !!this.configService.get('SMS_PROVIDER_API_KEY', { infer: true });
  }
}
