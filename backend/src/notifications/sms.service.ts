import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { errorMessage } from '../common/error-message';

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

  constructor(private configService: ConfigService) {}

  async sendReminderSms(phoneNumber: string, payload: SmsPayload): Promise<SmsResult> {
    const message = this.formatMessage(payload);

    if (!this.isConfigured()) {
      this.logger.log('='.repeat(60));
      this.logger.log('SMS REMINDER (Development Mode)');
      this.logger.log(`To: ${phoneNumber}`);
      this.logger.log(`Message: ${message}`);
      this.logger.log('='.repeat(60));
      return { success: true };
    }

    try {
      // TODO: Implement actual SMS provider integration (e.g., Twilio)
      this.logger.log(`SMS sent to ${phoneNumber}`);
      return { success: true };
    } catch (error) {
      this.logger.error(`Failed to send SMS to ${phoneNumber}: ${errorMessage(error)}`);
      return {
        success: false,
        errorMessage: errorMessage(error),
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
    return !!this.configService.get('SMS_PROVIDER_API_KEY');
  }
}
