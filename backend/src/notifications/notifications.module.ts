import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsService } from './sms.service';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [ConfigModule],
  providers: [SmsService, WhatsAppService],
  exports: [SmsService, WhatsAppService],
})
export class NotificationsModule {}
