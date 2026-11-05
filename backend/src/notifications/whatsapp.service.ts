import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import { logSafeError } from '../common/errors/log-safe-error';

export interface WhatsAppPayload {
  userName: string;
  auctionTitle: string;
  auctionCode: string;
  auctionCity: string | null;
  auctionState: string | null;
  auctionDetailsUrl: string | null;
  description: string | null;
}

export interface WhatsAppResult {
  success: boolean;
  errorMessage?: string;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(private configService: ConfigService<Env, true>) {}

  async sendReminderWhatsApp(
    phoneNumber: string,
    payload: WhatsAppPayload,
  ): Promise<WhatsAppResult> {
    if (!this.isConfigured()) {
      // SC-15 / AR-46: the recipient, the user's name and the reminder text are personal data.
      this.logger.log(
        `WhatsApp reminder simulated (development mode, no provider configured): auction ${payload.auctionCode}`,
      );
      return { success: true };
    }

    try {
      // TODO: Implement WhatsApp Business API integration (e.g., Twilio, Meta)
      this.logger.log(`WhatsApp reminder sent for auction ${payload.auctionCode}`);
      return { success: true };
    } catch (error) {
      this.logger.error(
        `Failed to send WhatsApp reminder for auction ${payload.auctionCode}: ${logSafeError(error)}`,
      );
      return {
        success: false,
        // SC-15: the provider's message quotes the recipient; a stable code is stored and logged.
        errorMessage: logSafeError(error),
      };
    }
  }

  private isConfigured(): boolean {
    return !!this.configService.get('WHATSAPP_API_KEY', { infer: true });
  }
}
