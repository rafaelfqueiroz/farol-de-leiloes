import {
  IsEnum,
  IsOptional,
  IsDateString,
  MaxLength,
  IsString,
} from 'class-validator';
import { ReminderChannel } from '../schemas/reminder.schema';

export class UpdateReminderDto {
  @IsOptional()
  @IsEnum(ReminderChannel)
  channel?: ReminderChannel;

  @IsOptional()
  @IsDateString()
  scheduledAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
