import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import businessConfig from '../config/business.config.js';
import { CommonModule } from './common.module.js';
import { BusinessCalendar } from './services/business-calendar.service.js';

/**
 * SPEC-004 BR-004-31. Apart from CommonModule because it reads the validated business settings:
 * a spec that boots CommonModule alone (JobExecutionService) must not need the environment.
 */
@Module({
  imports: [ConfigModule.forFeature(businessConfig), CommonModule],
  providers: [BusinessCalendar],
  exports: [BusinessCalendar],
})
export class BusinessCalendarModule {}
