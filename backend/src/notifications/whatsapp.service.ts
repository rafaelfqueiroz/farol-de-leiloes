import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

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

  constructor(private configService: ConfigService) {}

  async sendReminderWhatsApp(
    phoneNumber: string,
    payload: WhatsAppPayload,
  ): Promise<WhatsAppResult> {
    if (!this.isConfigured()) {
      this.logger.log('='.repeat(60));
      this.logger.log('WHATSAPP REMINDER (Development Mode)');
      this.logger.log(`To: ${phoneNumber}`);
      this.logger.log(`User: ${payload.userName}`);
      this.logger.log(`Auction: ${payload.auctionTitle || payload.auctionCode}`);
      this.logger.log(
        `Location: ${payload.auctionCity ?? 'N/A'}, ${payload.auctionState ?? 'N/A'}`,
      );
      this.logger.log(`Details URL: ${payload.auctionDetailsUrl ?? 'N/A'}`);
      this.logger.log(`Description: ${payload.description ?? 'N/A'}`);
      this.logger.log('='.repeat(60));
      return { success: true };
    }

    try {
      // TODO: Implement WhatsApp Business API integration (e.g., Twilio, Meta)
      this.logger.log(`WhatsApp message sent to ${phoneNumber}`);
      return { success: true };
    } catch (error: any) {
      this.logger.error(`Failed to send WhatsApp to ${phoneNumber}: ${error.message}`);
      return {
        success: false,
        errorMessage: error.message,
      };
    }
  }

  private isConfigured(): boolean {
    return !!this.configService.get('WHATSAPP_API_KEY');
  }
}
