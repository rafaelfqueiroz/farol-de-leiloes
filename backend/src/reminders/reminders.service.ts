import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  ReminderEntity,
  ReminderDocument,
  ReminderChannel,
  ReminderStatus,
} from './schemas/reminder.schema';
import { NotificationLog, NotificationLogDocument } from './schemas/notification-log.schema';
import { AuctionsService } from '../auctions/auctions.service';
import { UsersService } from '../users/users.service';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { AuctionRecord } from '../auctions/interfaces/auction.interface';
import { PopulatedReminder, ReminderAuction } from './interfaces/reminder.interface';

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
  ) {}

  async create(userId: string, dto: CreateReminderDto): Promise<PopulatedReminder> {
    const auction = await this.auctionsService.findDocumentByCode(dto.auctionId);
    if (!auction) {
      const auctionById = await this.findAuctionById(dto.auctionId);
      if (!auctionById) {
        throw new NotFoundException(`Leilao nao encontrado`);
      }
      return this.createWithAuction(userId, dto, auctionById);
    }
    return this.createWithAuction(userId, dto, auction);
  }

  private async findAuctionById(auctionId: string): Promise<ReminderTarget | null> {
    try {
      const AuctionModel = this.reminderModel.db.model<AuctionRecord>('AuctionEntity');
      return await AuctionModel.findById(auctionId).exec();
    } catch {
      return null;
    }
  }

  private async createWithAuction(
    userId: string,
    dto: CreateReminderDto,
    auction: ReminderTarget,
  ): Promise<PopulatedReminder> {
    const user = await this.usersService.findByIdFull(userId);
    if (!user) {
      throw new NotFoundException('Usuario nao encontrado');
    }

    this.validateChannelPermission(user, dto.channel);
    this.validateUserContactInfo(user, dto.channel);

    const auctionStartDate = this.getAuctionStartDate(auction);
    if (!auctionStartDate) {
      throw new BadRequestException('Leilao nao possui data de inicio definida');
    }

    if (new Date(auctionStartDate) <= new Date()) {
      throw new BadRequestException('Nao e possivel criar lembrete para leilao que ja iniciou');
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

  async findAllByUser(userId: string): Promise<PopulatedReminder[]> {
    return this.reminderModel
      .find({ userId: new Types.ObjectId(userId) })
      .populate<{ auction: ReminderAuction }>('auction')
      .sort({ scheduledAt: 1 })
      .exec();
  }

  async findOne(userId: string, reminderId: string): Promise<PopulatedReminder> {
    const reminder = await this.reminderModel
      .findOne({ _id: reminderId, userId: new Types.ObjectId(userId) })
      .populate<{ auction: ReminderAuction }>('auction')
      .exec();

    if (!reminder) {
      throw new NotFoundException('Lembrete nao encontrado');
    }

    return reminder;
  }

  async update(
    userId: string,
    reminderId: string,
    dto: UpdateReminderDto,
  ): Promise<PopulatedReminder> {
    const reminder = await this.reminderModel.findOne({
      _id: reminderId,
      userId: new Types.ObjectId(userId),
    });

    if (!reminder) {
      throw new NotFoundException('Lembrete nao encontrado');
    }

    if (reminder.status !== ReminderStatus.PENDING) {
      throw new BadRequestException('Nao e possivel editar um lembrete que ja foi enviado');
    }

    if (dto.channel && dto.channel !== reminder.channel) {
      const user = await this.usersService.findByIdFull(userId);
      if (!user) throw new NotFoundException('Usuario nao encontrado');
      this.validateChannelPermission(user, dto.channel);
      this.validateUserContactInfo(user, dto.channel);
      reminder.channel = dto.channel;
    }

    if (dto.scheduledAt) {
      const auction = await this.findAuctionById(reminder.auction.toString());
      if (!auction) {
        throw new NotFoundException('Leilao nao encontrado');
      }

      const auctionStartDate = this.getAuctionStartDate(auction);
      if (!auctionStartDate) {
        throw new BadRequestException('Leilao nao possui data de inicio definida');
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
      throw new NotFoundException('Lembrete nao encontrado');
    }
    return reminder;
  }

  async delete(userId: string, reminderId: string): Promise<void> {
    const reminder = await this.reminderModel.findOne({
      _id: reminderId,
      userId: new Types.ObjectId(userId),
    });

    if (!reminder) {
      throw new NotFoundException('Lembrete nao encontrado');
    }

    if (reminder.status !== ReminderStatus.PENDING) {
      throw new BadRequestException('Nao e possivel remover um lembrete que ja foi enviado');
    }

    await this.reminderModel.deleteOne({ _id: reminderId });
  }

  async getDueReminders(limit: number = 100): Promise<PopulatedReminder[]> {
    return this.reminderModel
      .find({
        status: ReminderStatus.PENDING,
        scheduledAt: { $lte: new Date() },
      })
      .populate<{ auction: ReminderAuction }>('auction')
      .limit(limit)
      .exec();
  }

  async markAsSent(reminderId: string): Promise<void> {
    await this.reminderModel.updateOne({ _id: reminderId }, { status: ReminderStatus.SENT });
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
        throw new ForbiddenException(
          `Canal ${channel} disponivel apenas para planos Standard e Premium`,
        );
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
          throw new BadRequestException('Email verificado e necessario para lembretes por email');
        }
        break;
      case ReminderChannel.SMS:
      case ReminderChannel.WHATSAPP:
        if (!user.phone) {
          throw new BadRequestException(
            'Telefone cadastrado e necessario para lembretes por SMS/WhatsApp',
          );
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
    const scheduledAt = new Date(scheduledAtStr);

    if (scheduledAt <= new Date()) {
      throw new BadRequestException('A data do lembrete deve ser no futuro');
    }

    if (scheduledAt >= auctionStartDate) {
      throw new BadRequestException('A data do lembrete deve ser antes do inicio do leilao');
    }

    const minutes = scheduledAt.getMinutes();
    const normalizedMinutes = Math.round(minutes / 15) * 15;

    if (normalizedMinutes !== minutes) {
      scheduledAt.setMinutes(normalizedMinutes);
      scheduledAt.setSeconds(0);
      scheduledAt.setMilliseconds(0);
    }

    return scheduledAt;
  }
}
