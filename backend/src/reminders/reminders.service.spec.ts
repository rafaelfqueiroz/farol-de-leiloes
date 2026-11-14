import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { DomainError } from '../common/errors/domain-error.js';
import { RemindersService } from './reminders.service.js';
import type { CreateReminderDto } from './dto/create-reminder.dto.js';
import { FakeClock } from '../../test/fakes/fake-clock.js';
import { serverOperators } from '../common/mongo/query-safety.js';
import { ReminderChannel, ReminderStatus } from './schemas/reminder.schema.js';

type ServiceDeps = ConstructorParameters<typeof RemindersService>;

// AR-09: both reminder creation and rescheduling reach auctions only through their service.
describe('RemindersService auction lookup boundary (AR-09)', () => {
  function build(codeResult: unknown = null) {
    const auctionsService = {
      findDocumentByCode: vi.fn().mockResolvedValue(codeResult),
      findDocumentById: vi.fn().mockResolvedValue(null),
    };
    const reminder = { status: 'PENDING', auction: { toString: () => '64b000000000000000000001' } };
    const service = new RemindersService(
      { findOne: vi.fn().mockResolvedValue(reminder) } as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      auctionsService as unknown as ServiceDeps[2],
      { findByIdFull: vi.fn().mockResolvedValue(null) } as unknown as ServiceDeps[3],
      new FakeClock(),
    );
    return { service, auctionsService };
  }

  const dto = (auctionId: unknown) => ({ auctionId }) as unknown as CreateReminderDto;

  it('falls back to AuctionsService by id when no auction has the given code', async () => {
    const { service, auctionsService } = build();

    await expect(service.create('u1', dto('64b000000000000000000001'))).rejects.toEqual(
      new DomainError('AUCTION_NOT_FOUND'),
    );
    expect(auctionsService.findDocumentByCode).toHaveBeenCalledWith('64b000000000000000000001');
    expect(auctionsService.findDocumentById).toHaveBeenCalledWith('64b000000000000000000001');
    expect(auctionsService.findDocumentByCode.mock.invocationCallOrder[0]).toBeLessThan(
      auctionsService.findDocumentById.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('uses the code match without an id lookup', async () => {
    const userId = new Types.ObjectId('64b000000000000000000002');
    const auctionId = new Types.ObjectId('64b000000000000000000001');
    const reminderId = new Types.ObjectId('64b000000000000000000003');
    const auction = {
      _id: auctionId,
      phases: [{ phaseDates: ['2026-01-20T13:00:00.000Z'] }],
    };
    const auctionsService = {
      findDocumentByCode: vi.fn().mockResolvedValue(auction),
      findDocumentById: vi.fn().mockResolvedValue(null),
    };
    const persisted: Record<string, unknown>[] = [];
    const populated = { _id: reminderId, auction, status: ReminderStatus.PENDING };
    class ReminderPersistenceFake {
      constructor(fields: Record<string, unknown>) {
        persisted.push(fields);
      }

      async save() {
        return { _id: reminderId };
      }

      static findById = vi.fn().mockReturnValue({
        populate: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(populated) }),
      });
    }
    const service = new RemindersService(
      ReminderPersistenceFake as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      auctionsService as unknown as ServiceDeps[2],
      {
        findByIdFull: vi.fn().mockResolvedValue({
          role: 'free',
          email: 'reminder@example.test',
          emailVerified: true,
        }),
      } as unknown as ServiceDeps[3],
      new FakeClock(new Date('2026-01-15T12:00:00.000Z')),
    );

    await expect(
      service.create(userId.toHexString(), {
        auctionId: 'A1',
        channel: ReminderChannel.EMAIL,
        scheduledAt: '2026-01-16T12:00:00.000Z',
      }),
    ).resolves.toBe(populated);
    expect(persisted).toEqual([
      {
        userId,
        auction: auctionId,
        channel: ReminderChannel.EMAIL,
        scheduledAt: new Date('2026-01-16T12:00:00.000Z'),
        description: undefined,
        status: ReminderStatus.PENDING,
      },
    ]);
    expect(auctionsService.findDocumentByCode).toHaveBeenCalledWith('A1');
    expect(auctionsService.findDocumentById).not.toHaveBeenCalled();
    expect(ReminderPersistenceFake.findById).toHaveBeenCalledWith(reminderId);
  });

  it('resolves the saved auction id through AuctionsService when rescheduling', async () => {
    const { service, auctionsService } = build();

    await expect(
      service.update('64b000000000000000000002', 'r1', {
        scheduledAt: '2026-01-16T12:00:00.000Z',
      }),
    ).rejects.toEqual(new DomainError('AUCTION_NOT_FOUND'));
    expect(auctionsService.findDocumentById).toHaveBeenCalledWith('64b000000000000000000001');
    expect(auctionsService.findDocumentByCode).not.toHaveBeenCalled();
  });
});

// AR-24 / TS-06: "in the past" and "due" are decided against the injected clock; a time written
// without an offset is Brasília wall-clock time (AR-23).
describe('RemindersService and the clock (AR-24)', () => {
  const NOW = new Date('2026-01-15T12:00:00.000Z'); // 09:00 in Brasília
  const AUCTION_START = new Date('2026-01-20T13:00:00.000Z');

  function build() {
    const find = vi.fn().mockReturnValue({
      populate: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue([]) }),
      }),
    });
    const service = new RemindersService(
      { find } as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      {} as ServiceDeps[2],
      {} as ServiceDeps[3],
      new FakeClock(NOW),
    );
    // Private; bracket access keeps its signature type-checked.
    const schedule = (at: string) => service['validateAndNormalizeScheduledAt'](at, AUCTION_START);
    return { service, find, schedule };
  }

  it('due reminders are those scheduled at or before now', async () => {
    const { service, find } = build();

    await service.getDueReminders(10);

    expect(find).toHaveBeenCalledWith({
      status: 'PENDING',
      scheduledAt: serverOperators({ $lte: NOW }),
    });
  });

  it('refuses a time at or before now and accepts one just after', () => {
    const { schedule } = build();

    expect(() => schedule('2026-01-15T12:00:00.000Z')).toThrow(
      new DomainError('REMINDER_DATE_IN_PAST'),
    );
    expect(schedule('2026-01-15T12:15:00.000Z')).toEqual(new Date('2026-01-15T12:15:00.000Z'));
  });

  it('reads a time without an offset as Brasília time, not the server zone', () => {
    const { schedule } = build();

    // 15/01 10:00 in Brasília = 13:00 UTC: one hour after now.
    expect(schedule('2026-01-15T10:00:00')).toEqual(new Date('2026-01-15T13:00:00.000Z'));
    // 15/01 08:45 in Brasília is before 09:00 there, so in the past.
    expect(() => schedule('2026-01-15T08:45:00')).toThrow(new DomainError('REMINDER_DATE_IN_PAST'));
  });

  it('refuses a time at or after the auction start', () => {
    const { schedule } = build();

    expect(() => schedule('2026-01-20T13:00:00.000Z')).toThrow(
      new DomainError('REMINDER_AFTER_AUCTION_START'),
    );
  });

  // AR-23 / #82: rounding runs first, in Brasília time, and the checks judge the rounded instant.
  describe('rounding to 15 minutes (#82)', () => {
    it('rounds across the hour and day boundary in Brasília: 23:53 -> 00:00 next day', () => {
      const { schedule } = build();

      // 16/01 23:53 in Brasília rounds to 17/01 00:00 Brasília = 03:00Z.
      expect(schedule('2026-01-16T23:53:00')).toEqual(new Date('2026-01-17T03:00:00.000Z'));
    });

    it('rounds to the nearest quarter, down and up', () => {
      const { schedule } = build();

      expect(schedule('2026-01-16T10:07:00')).toEqual(new Date('2026-01-16T13:00:00.000Z'));
      expect(schedule('2026-01-16T10:08:00')).toEqual(new Date('2026-01-16T13:15:00.000Z'));
    });

    it('always lands on an exact 15-minute boundary, dropping seconds and milliseconds', () => {
      const { schedule } = build();

      expect(schedule('2026-01-16T10:15:30.500')).toEqual(new Date('2026-01-16T13:15:00.000Z'));
      expect(schedule('2026-01-16T10:14:59.999')).toEqual(new Date('2026-01-16T13:15:00.000Z'));
    });

    it('refuses a time that rounds onto the auction start', () => {
      const { schedule } = build();

      // Auction starts 20/01 13:00Z = 10:00 Brasília; 09:53 rounds to 10:00.
      expect(() => schedule('2026-01-20T09:53:00')).toThrow(
        new DomainError('REMINDER_AFTER_AUCTION_START'),
      );
    });

    it('refuses a time just after now that rounds down onto now', () => {
      const { schedule } = build();

      // Now is 09:00 Brasília; 09:05 is in the future but rounds down to 09:00.
      expect(() => schedule('2026-01-15T09:05:00')).toThrow(
        new DomainError('REMINDER_DATE_IN_PAST'),
      );
    });
  });
});
