import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../common/errors/domain-error';
import { RemindersService } from './reminders.service';
import type { CreateReminderDto } from './dto/create-reminder.dto';
import { FakeClock } from '../../test/fakes/fake-clock';
import { serverOperators } from '../common/mongo/query-safety';

type ServiceDeps = ConstructorParameters<typeof RemindersService>;

// SC-10: the fallback lookup of an auction by id compares by equality, and a non-string id is no
// auction. `create` reaches it only when no auction has the given code.
describe('RemindersService.create auction lookup by id (SC-10)', () => {
  function build(byId: { findOne: ReturnType<typeof vi.fn> }) {
    const reminderModel = { db: { model: vi.fn().mockReturnValue(byId) } };
    const auctionsService = { findDocumentByCode: vi.fn().mockResolvedValue(null) };
    const service = new RemindersService(
      reminderModel as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      auctionsService as unknown as ServiceDeps[2],
      {} as ServiceDeps[3],
      new FakeClock(),
    );
    return { service, reminderModel };
  }

  const dto = (auctionId: unknown) => ({ auctionId }) as unknown as CreateReminderDto;

  it('looks the auction up by _id with equality when the code is unknown', async () => {
    const findOne = vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(null) });
    const { service } = build({ findOne });

    await expect(service.create('u1', dto('64b000000000000000000001'))).rejects.toEqual(
      new DomainError('AUCTION_NOT_FOUND'),
    );
    expect(findOne).toHaveBeenCalledWith({ _id: { $eq: '64b000000000000000000001' } });
  });

  it('treats a non-string id as no auction, without querying', async () => {
    const findOne = vi.fn();
    const { service, reminderModel } = build({ findOne });

    await expect(service.create('u1', dto({ $ne: null }))).rejects.toEqual(
      new DomainError('AUCTION_NOT_FOUND'),
    );
    expect(reminderModel.db.model).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('treats a lookup error as no auction', async () => {
    const findOne = vi.fn().mockReturnValue({ exec: vi.fn().mockRejectedValue(new Error('cast')) });
    const { service } = build({ findOne });

    await expect(service.create('u1', dto('not-an-id'))).rejects.toEqual(
      new DomainError('AUCTION_NOT_FOUND'),
    );
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
});
