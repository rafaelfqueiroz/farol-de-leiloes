import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SmsService } from './sms.service.js';
import { WhatsAppService } from './whatsapp.service.js';

@Module({
  imports: [ConfigModule],
  providers: [SmsService, WhatsAppService],
  exports: [SmsService, WhatsAppService],
})
export class NotificationsModule {}
