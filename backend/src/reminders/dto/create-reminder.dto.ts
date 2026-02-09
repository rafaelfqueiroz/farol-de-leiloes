import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsOptional,
  IsDateString,
  MaxLength,
  IsMongoId,
} from 'class-validator';
import { ReminderChannel } from '../schemas/reminder.schema';

export class CreateReminderDto {
  @IsMongoId()
  @IsNotEmpty()
  auctionId!: string;

  @IsEnum(ReminderChannel)
  @IsNotEmpty()
  channel!: ReminderChannel;

  @IsDateString()
  @IsNotEmpty()
  scheduledAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
