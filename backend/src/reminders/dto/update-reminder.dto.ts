import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsDateString, MaxLength, IsString } from 'class-validator';
import { ReminderChannel } from '../schemas/reminder.schema.js';

export class UpdateReminderDto {
  @ApiPropertyOptional({ enum: ReminderChannel, enumName: 'ReminderChannel' })
  @IsOptional()
  @IsEnum(ReminderChannel)
  channel?: ReminderChannel;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @ApiPropertyOptional({ type: String, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
