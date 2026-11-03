import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsEnum, IsOptional, IsDateString, MaxLength } from 'class-validator';
import { ReminderChannel } from '../schemas/reminder.schema';

export class CreateReminderDto {
  @ApiProperty({ type: String, description: 'Id of the auction (its `_id`)' })
  @IsString()
  @IsNotEmpty()
  auctionId!: string;

  @ApiProperty({ enum: ReminderChannel, enumName: 'ReminderChannel' })
  @IsEnum(ReminderChannel)
  @IsNotEmpty()
  channel!: ReminderChannel;

  @ApiProperty({ type: String, format: 'date-time' })
  @IsDateString()
  @IsNotEmpty()
  scheduledAt!: string;

  @ApiPropertyOptional({ type: String, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
