import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { parseISO, roundToNearestMinutes } from 'date-fns';
import {
  ReminderEntity,
  ReminderDocument,
  ReminderChannel,
  ReminderStatus,
} from './schemas/reminder.schema.js';
import { NotificationLog, NotificationLogDocument } from './schemas/notification-log.schema.js';
import { AuctionsService } from '../auctions/auctions.service.js';
import { UsersService } from '../users/users.service.js';
import { CreateReminderDto } from './dto/create-reminder.dto.js';
import { UpdateReminderDto } from './dto/update-reminder.dto.js';
import { AuctionRecord } from '../auctions/interfaces/auction.interface.js';
import { PopulatedReminder, ReminderAuction } from './interfaces/reminder.interface.js';
import { DomainError } from '../common/errors/domain-error.js';
import { serverOperators } from '../common/mongo/query-safety.js';
import { Clock } from '../common/clock/clock.js';
import { inBrasilia } from '../common/clock/brasilia-time.js';
import {
  type PageRequest,
  type Paginated,
  paginated,
  skipOf,
} from '../common/pagination/paginated.js';

// The auction fields a reminder is created against.
type ReminderTarget = Pick<AuctionRecord, 'phases'> & { _id: Types.ObjectId };

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @InjectModel(ReminderEntity.name)
    private readonly reminderModel: Model<ReminderDocument>,
    @InjectModel(NotificationLog.name)
    private readonly notificationLogModel: Model<NotificationLogDocument>,
    private readonly auctionsService: AuctionsService,
    private readonly usersService: UsersService,
    private readonly clock: Clock, // AR-24
  ) {}

  async create(userId: string, dto: CreateReminderDto): Promise<PopulatedReminder> {
    const auction = await this.auctionsService.findDocumentByCode(dto.auctionId);
    if (!auction) {
      const auctionById = await this.auctionsService.findDocumentById(dto.auctionId);
      if (!auctionById) {
        throw new DomainError('AUCTION_NOT_FOUND');
      }
      return this.createWithAuction(userId, dto, auctionById);
    }
    return this.createWithAuction(userId, dto, auction);
  }

  private async createWithAuction(
    userId: string,
    dto: CreateReminderDto,
    auction: ReminderTarget,
  ): Promise<PopulatedReminder> {
    const user = await this.usersService.findByIdFull(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    this.validateChannelPermission(user, dto.channel);
    this.validateUserContactInfo(user, dto.channel);

    const auctionStartDate = this.getAuctionStartDate(auction);
    if (!auctionStartDate) {
      throw new DomainError('AUCTION_START_DATE_MISSING');
    }

    if (auctionStartDate <= this.clock.now()) {
      throw new DomainError('AUCTION_ALREADY_STARTED');
    }

    const scheduledAt = this.validateAndNormalizeScheduledAt(dto.scheduledAt, auctionStartDate);

    const reminder = new this.reminderModel({
      userId: new Types.ObjectId(userId),
      auction: auction._id,
      channel: dto.channel,
      scheduledAt,
      description: dto.description,
      status: ReminderStatus.PENDING,
    });

    const saved = await reminder.save();
    return this.findPopulatedById(saved._id);
  }

  /** AR-35: one page of the user's reminders, soonest first (`_id` breaks scheduledAt ties). */
  async findPageByUser(userId: string, page: PageRequest): Promise<Paginated<PopulatedReminder>> {
    const filter = { userId: new Types.ObjectId(userId) };
    const [total, items] = await Promise.all([
      this.reminderModel.countDocuments(filter).exec(),
      this.reminderModel
        .find(filter)
        .populate<{ auction: ReminderAuction }>('auction')
        .sort({ scheduledAt: 1, _id: 1 })
        .skip(skipOf(page))
        .limit(page.pageSize)
        .exec(),
    ]);
    return paginated(items, total, page);
  }

  async findOne(userId: string, reminderId: string): Promise<PopulatedReminder> {
    const reminder = await this.reminderModel
      .findOne({ _id: { $eq: reminderId }, userId: new Types.ObjectId(userId) })
      .populate<{ auction: ReminderAuction }>('auction')
      .exec();

    if (!reminder) {
      throw new DomainError('REMINDER_NOT_FOUND');
    }

    return reminder;
  }

  async update(
    userId: string,
    reminderId: string,
    dto: UpdateReminderDto,
  ): Promise<PopulatedReminder> {
    const reminder = await this.reminderModel.findOne({
      _id: { $eq: reminderId },
      userId: new Types.ObjectId(userId),
    });

    if (!reminder) {
      throw new DomainError('REMINDER_NOT_FOUND');
    }

    if (reminder.status !== ReminderStatus.PENDING) {
      throw new DomainError('REMINDER_ALREADY_SENT');
    }

    if (dto.channel && dto.channel !== reminder.channel) {
      const user = await this.usersService.findByIdFull(userId);
      if (!user) throw new DomainError('USER_NOT_FOUND');
      this.validateChannelPermission(user, dto.channel);
      this.validateUserContactInfo(user, dto.channel);
      reminder.channel = dto.channel;
    }

    if (dto.scheduledAt) {
      const auction = await this.auctionsService.findDocumentById(reminder.auction.toString());
      if (!auction) {
        throw new DomainError('AUCTION_NOT_FOUND');
      }

      const auctionStartDate = this.getAuctionStartDate(auction);
      if (!auctionStartDate) {
        throw new DomainError('AUCTION_START_DATE_MISSING');
      }

      reminder.scheduledAt = this.validateAndNormalizeScheduledAt(
        dto.scheduledAt,
        auctionStartDate,
      );
    }

    if (dto.description !== undefined) {
      reminder.description = dto.description;
    }

    await reminder.save();
    return this.findPopulatedById(reminder._id);
  }

  // Re-reads a reminder just saved, with its auction. Deleted in between → 404 (DV-03).
  private async findPopulatedById(id: Types.ObjectId): Promise<PopulatedReminder> {
    const reminder = await this.reminderModel
      .findById(id)
      .populate<{ auction: ReminderAuction }>('auction')
      .exec();
    if (!reminder) {
      throw new DomainError('REMINDER_NOT_FOUND');
    }
    return reminder;
  }

  async delete(userId: string, reminderId: string): Promise<void> {
    const reminder = await this.reminderModel.findOne({
      _id: { $eq: reminderId },
      userId: new Types.ObjectId(userId),
    });

    if (!reminder) {
      throw new DomainError('REMINDER_NOT_FOUND');
    }

    if (reminder.status !== ReminderStatus.PENDING) {
      throw new DomainError('REMINDER_ALREADY_SENT');
    }

    await this.reminderModel.deleteOne({ _id: { $eq: reminderId } });
  }

  async getDueReminders(limit: number = 100): Promise<PopulatedReminder[]> {
    return this.reminderModel
      .find({
        status: ReminderStatus.PENDING,
        scheduledAt: serverOperators({ $lte: this.clock.now() }),
      })
      .populate<{ auction: ReminderAuction }>('auction')
      .limit(limit)
      .exec();
  }

  async markAsSent(reminderId: string): Promise<void> {
    await this.reminderModel.updateOne(
      { _id: { $eq: reminderId } },
      { status: ReminderStatus.SENT },
    );
  }

  async logNotification(
    reminderId: string,
    userId: string,
    channel: ReminderChannel,
    recipient: string,
    success: boolean,
    errorMessage?: string,
  ): Promise<void> {
    const log = new this.notificationLogModel({
      reminderId: new Types.ObjectId(reminderId),
      userId: new Types.ObjectId(userId),
      channel,
      recipient,
      success,
      errorMessage,
    });
    await log.save();
  }

  private validateChannelPermission(user: { role: string }, channel: ReminderChannel): void {
    const premiumChannels = [ReminderChannel.SMS, ReminderChannel.WHATSAPP];

    if (premiumChannels.includes(channel)) {
      const allowedRoles = ['standard', 'premium', 'admin'];
      if (!allowedRoles.includes(user.role)) {
        throw new DomainError('REMINDER_CHANNEL_NOT_IN_PLAN', { channel });
      }
    }
  }

  private validateUserContactInfo(
    user: { email?: string; emailVerified?: boolean; phone?: string },
    channel: ReminderChannel,
  ): void {
    switch (channel) {
      case ReminderChannel.EMAIL:
        if (!user.email || !user.emailVerified) {
          throw new DomainError('EMAIL_VERIFICATION_REQUIRED');
        }
        break;
      case ReminderChannel.SMS:
      case ReminderChannel.WHATSAPP:
        if (!user.phone) {
          throw new DomainError('PHONE_REQUIRED', { channel });
        }
        break;
    }
  }

  private getAuctionStartDate(auction: Pick<AuctionRecord, 'phases'>): Date | null {
    const phases = auction.phases ?? [];
    if (phases.length === 0) return null;

    const lastPhase = phases[phases.length - 1];
    const [firstDate] = lastPhase?.phaseDates ?? [];
    if (firstDate === undefined) return null;

    return new Date(firstDate);
  }

  private validateAndNormalizeScheduledAt(scheduledAtStr: string, auctionStartDate: Date): Date {
    // An ISO string from the DTO: an offset, when given, says which instant it is; without one
    // it is Brasília wall-clock time (AR-23), never the server's own zone.
    const parsed = parseISO(scheduledAtStr, { in: inBrasilia });

    // AR-23 / #82: round to the nearest 15 minutes in Brasília time, seconds and milliseconds
    // dropped, BEFORE validating — the stored instant is what must be in the future and before the
    // auction start. date-fns v4 truncates by default, so the rounding method is explicit.
    const scheduledAt = new Date(
      roundToNearestMinutes(parsed, {
        nearestTo: 15,
        roundingMethod: 'round',
        in: inBrasilia,
      }).getTime(),
    );

    if (scheduledAt <= this.clock.now()) {
      throw new DomainError('REMINDER_DATE_IN_PAST');
    }

    if (scheduledAt >= auctionStartDate) {
      throw new DomainError('REMINDER_AFTER_AUCTION_START');
    }

    return scheduledAt;
  }
}
