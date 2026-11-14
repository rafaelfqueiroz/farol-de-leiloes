// AR-36: a reminder leaves the API through these classes, each field copied explicitly.
import { ApiProperty } from '@nestjs/swagger';
import { ReminderChannel, ReminderStatus } from '../schemas/reminder.schema.js';
import { PopulatedReminder, ReminderAuction } from '../interfaces/reminder.interface.js';

/** The auction a reminder is about; empty values when the auction no longer exists. */
export class ReminderAuctionDto {
  @ApiProperty({ type: String, description: 'Empty when the auction no longer exists' })
  _id: string;

  @ApiProperty({ type: String, description: 'Empty when the auction no longer exists' })
  code: string;

  @ApiProperty({ type: String, nullable: true })
  title: string | null;

  @ApiProperty({ type: String, nullable: true })
  city: string | null;

  @ApiProperty({ type: String, nullable: true })
  state: string | null;

  @ApiProperty({ type: String, nullable: true })
  detailsUrl: string | null;

  constructor(auction: ReminderAuction) {
    this._id = auction?._id.toString() ?? '';
    this.code = auction?.code ?? '';
    this.title = auction?.title ?? null;
    this.city = auction?.address?.city ?? null;
    this.state = auction?.address?.state ?? null;
    this.detailsUrl = auction?.detailsUrl ?? null;
  }
}

export class ReminderResponseDto {
  @ApiProperty({ type: String })
  _id: string;

  @ApiProperty({ enum: ReminderChannel, enumName: 'ReminderChannel' })
  channel: ReminderChannel;

  @ApiProperty({ type: String, format: 'date-time' })
  scheduledAt: Date;

  @ApiProperty({ type: String, nullable: true })
  description: string | null;

  @ApiProperty({ enum: ReminderStatus, enumName: 'ReminderStatus' })
  status: ReminderStatus;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt: Date;

  @ApiProperty({ type: () => ReminderAuctionDto })
  auction: ReminderAuctionDto;

  constructor(reminder: PopulatedReminder) {
    this._id = reminder._id.toString();
    this.channel = reminder.channel;
    this.scheduledAt = reminder.scheduledAt;
    this.description = reminder.description ?? null;
    this.status = reminder.status;
    this.createdAt = reminder.createdAt;
    this.auction = new ReminderAuctionDto(reminder.auction);
  }
}
