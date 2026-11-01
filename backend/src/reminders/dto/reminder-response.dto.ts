import { ReminderChannel, ReminderStatus } from '../schemas/reminder.schema';
import { PopulatedReminder } from '../interfaces/reminder.interface';

export class ReminderResponseDto {
  _id: string;
  channel: ReminderChannel;
  scheduledAt: Date;
  description: string | null;
  status: ReminderStatus;
  createdAt: Date;
  auction: {
    _id: string;
    code: string;
    title: string | null;
    city: string | null;
    state: string | null;
    detailsUrl: string | null;
  };

  constructor(reminder: PopulatedReminder) {
    this._id = reminder._id.toString();
    this.channel = reminder.channel;
    this.scheduledAt = reminder.scheduledAt;
    this.description = reminder.description ?? null;
    this.status = reminder.status;
    this.createdAt = reminder.createdAt;

    const auction = reminder.auction;
    this.auction = {
      _id: auction?._id.toString() ?? '',
      code: auction?.code ?? '',
      title: auction?.title ?? null,
      city: auction?.address?.city ?? null,
      state: auction?.address?.state ?? null,
      detailsUrl: auction?.detailsUrl ?? null,
    };
  }
}
