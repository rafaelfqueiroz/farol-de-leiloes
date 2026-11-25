import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import { parseISO, roundToNearestMinutes } from 'date-fns';
import { ReminderChannel, ReminderStatus } from './schemas/reminder.schema.js';
import type { AccessContext } from '../access/access-context.js';
import { RemindersRepository, type ReminderRecord } from './reminders.repository.js';
import { NotificationLogsRepository } from './notification-logs.repository.js';
import { AuctionsService } from '../auctions/auctions.service.js';
import { UsersService } from '../users/users.service.js';
import { CreateReminderDto } from './dto/create-reminder.dto.js';
import { UpdateReminderDto } from './dto/update-reminder.dto.js';
import { AuctionRecord } from '../auctions/interfaces/auction.interface.js';
import { PopulatedReminder } from './interfaces/reminder.interface.js';
import { DomainError } from '../common/errors/domain-error.js';
import { Clock } from '../common/clock/clock.js';
import { inBrasilia } from '../common/clock/brasilia-time.js';
import { type PageRequest, type Paginated, paginated } from '../common/pagination/paginated.js';

// The auction fields a reminder is created against.
type ReminderTarget = Pick<AuctionRecord, 'phases'> & { _id: Types.ObjectId };

// SPEC-002 BR-002-02: a reminder belongs to its account alone. Request paths take the request's
// AccessContext and reach reminders only through the account-scoped repository (AR-08, AR-12); the
// scheduler's paths (getDueReminders, markAsSent, logNotification) are the named cross-account
// ones, and deliver each reminder to its own account (BR-002-29).
@Injectable()
export class RemindersService {
  constructor(
    private readonly reminders: RemindersRepository,
    private readonly notificationLogs: NotificationLogsRepository,
    private readonly auctionsService: AuctionsService,
    private readonly usersService: UsersService,
    private readonly clock: Clock, // AR-24
  ) {}

  async create(ctx: AccessContext, dto: CreateReminderDto): Promise<PopulatedReminder> {
    const auction = await this.auctionsService.findDocumentByCode(dto.auctionId);
    if (!auction) {
      const auctionById = await this.auctionsService.findDocumentById(dto.auctionId);
      if (!auctionById) {
        throw new DomainError('AUCTION_NOT_FOUND');
      }
      return this.createWithAuction(ctx, dto, auctionById);
    }
    return this.createWithAuction(ctx, dto, auction);
  }

  private async createWithAuction(
    ctx: AccessContext,
    dto: CreateReminderDto,
    auction: ReminderTarget,
  ): Promise<PopulatedReminder> {
    const user = await this.usersService.findByIdFull(ctx.accountId);
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

    // BR-002-11: the account comes from the context, never from the request body.
    const saved = await this.reminders.create(ctx, {
      auction: auction._id,
      channel: dto.channel,
      scheduledAt,
      description: dto.description,
      status: ReminderStatus.PENDING,
    });
    return this.findPopulatedById(ctx, saved._id.toString());
  }

  /** AR-35: one page of the account's reminders, soonest first (`_id` breaks scheduledAt ties). */
  async findPageByUser(
    ctx: AccessContext,
    page: PageRequest,
  ): Promise<Paginated<PopulatedReminder>> {
    const [total, items] = await Promise.all([
      this.reminders.count(ctx),
      this.reminders.findPopulatedPage(ctx, page),
    ]);
    return paginated(items, total, page);
  }

  /** REMINDER_NOT_FOUND alike for another account's, a missing and a malformed id (AR-14). */
  async findOne(ctx: AccessContext, reminderId: string): Promise<PopulatedReminder> {
    return this.findPopulatedById(ctx, reminderId);
  }

  async update(
    ctx: AccessContext,
    reminderId: string,
    dto: UpdateReminderDto,
  ): Promise<PopulatedReminder> {
    const reminder = await this.pendingReminder(ctx, reminderId);
    const changes: Partial<Pick<ReminderRecord, 'channel' | 'scheduledAt' | 'description'>> = {};

    if (dto.channel && dto.channel !== reminder.channel) {
      const user = await this.usersService.findByIdFull(ctx.accountId);
      if (!user) throw new DomainError('USER_NOT_FOUND');
      this.validateChannelPermission(user, dto.channel);
      this.validateUserContactInfo(user, dto.channel);
      changes.channel = dto.channel;
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

      changes.scheduledAt = this.validateAndNormalizeScheduledAt(dto.scheduledAt, auctionStartDate);
    }

    if (dto.description !== undefined) {
      changes.description = dto.description;
    }

    if (Object.keys(changes).length > 0) {
      // One conditional write: still the account's and still pending (a reminder the scheduler
      // sent in between is not changed).
      await this.reminders.updateById(ctx, reminderId, changes, {
        status: { $eq: ReminderStatus.PENDING },
      });
    }
    return this.findPopulatedById(ctx, reminderId);
  }

  // Re-reads a reminder of the account with its auction. Gone in between → 404 (DV-03).
  private async findPopulatedById(ctx: AccessContext, id: string): Promise<PopulatedReminder> {
    const reminder = await this.reminders.findPopulatedById(ctx, id);
    if (!reminder) {
      throw new DomainError('REMINDER_NOT_FOUND');
    }
    return reminder;
  }

  async delete(ctx: AccessContext, reminderId: string): Promise<void> {
    await this.pendingReminder(ctx, reminderId);
    await this.reminders.deleteById(ctx, reminderId, { status: { $eq: ReminderStatus.PENDING } });
  }

  /** The account's reminder, still pending: REMINDER_NOT_FOUND, else REMINDER_ALREADY_SENT. */
  private async pendingReminder(ctx: AccessContext, reminderId: string): Promise<ReminderRecord> {
    const reminder = await this.reminders.findById(ctx, reminderId);
    if (!reminder) {
      throw new DomainError('REMINDER_NOT_FOUND');
    }
    if (reminder.status !== ReminderStatus.PENDING) {
      throw new DomainError('REMINDER_ALREADY_SENT');
    }
    return reminder;
  }

  /** Scheduler (AR-12, BR-002-29): every account's pending reminders due now. */
  async getDueReminders(limit: number = 100): Promise<PopulatedReminder[]> {
    return this.reminders.findDueAcrossAccounts(this.clock.now(), limit);
  }

  /**
   * Scheduler (AR-12, BR-009-17): the reminder as it is now, if it is still pending and due; null when
   * it is not. Read right before sending: the due batch may be minutes old by a reminder's turn.
   */
  findStillDue(reminderId: string): Promise<PopulatedReminder | null> {
    return this.reminders.findStillDueAcrossAccounts(reminderId, this.clock.now());
  }

  /**
   * SPEC-010 BR-010-14 (closure effect, repeated by the purge): the closed account's pending
   * reminders are cancelled so the scheduler never selects them. Idempotent; answers how many.
   */
  cancelPendingOfAccount(userId: string): Promise<number> {
    return this.reminders.cancelPendingOfAccountByJob(userId);
  }

  /**
   * SPEC-009 BR-009-17: a reactivated account's reminders whose time passed while it was deactivated
   * are cancelled, never sent late; the ones still in the future stay. Idempotent; answers how many.
   */
  cancelDueOfAccount(userId: string): Promise<number> {
    return this.reminders.cancelDueOfAccountByJob(userId, this.clock.now());
  }

  /** Scheduler (AR-12): the reminder's account is not active; it will never be sent. */
  async markAsCancelled(reminderId: string): Promise<void> {
    await this.reminders.markCancelledAcrossAccounts(reminderId);
  }

  /** Scheduler (AR-12): the reminder it just delivered is sent. */
  async markAsSent(reminderId: string): Promise<void> {
    await this.reminders.markSentAcrossAccounts(reminderId);
  }

  /** Scheduler (AR-12, BR-002-29): the attempt is logged for the reminder's own account. */
  async logNotification(
    reminderId: string,
    userId: string,
    channel: ReminderChannel,
    recipient: string,
    success: boolean,
    errorMessage?: string,
  ): Promise<void> {
    await this.notificationLogs.recordDeliveryByJob(userId, {
      reminderId,
      channel,
      recipient,
      success,
      errorMessage,
    });
  }

  private validateChannelPermission(user: { role: string }, channel: ReminderChannel): void {
    const premiumChannels = [ReminderChannel.SMS, ReminderChannel.WHATSAPP];

    if (premiumChannels.includes(channel)) {
      // SPEC-002 BR-002-23: admin capability grants no paid feature; a legacy `role: 'admin'` is
      // no plan at all. SPEC-012 moves this check to the plan entitlements (EntitlementGuard).
      const allowedRoles = ['standard', 'premium'];
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
