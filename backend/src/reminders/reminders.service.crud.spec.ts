import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { DomainError } from '../common/errors/domain-error.js';
import { RemindersService } from './reminders.service.js';
import { ReminderChannel, ReminderStatus } from './schemas/reminder.schema.js';
import type { CreateReminderDto } from './dto/create-reminder.dto.js';
import { FakeClock } from '../../test/fakes/fake-clock.js';
import { FakeQuery } from '../../test/fakes/fake-query.js';

type Deps = ConstructorParameters<typeof RemindersService>;

const NOW = new Date('2026-01-15T12:00:00.000Z');
const USER_ID = '64b000000000000000000002';
const AUCTION_ID = new Types.ObjectId('64b000000000000000000001');
const REMINDER_ID = new Types.ObjectId('64b000000000000000000003');
const START_ISO = '2026-01-20T13:00:00.000Z';
const AUCTION = { _id: AUCTION_ID, phases: [{ phaseDates: [START_ISO] }] };
const VERIFIED_USER = { role: 'free', email: 'a@example.test', emailVerified: true };

/** A stand-in for the reminder model: the constructor captures the new document, statics are spies. */
function aModel(opts: {
  stored?: unknown;
  populated?: unknown;
  items?: unknown[];
  total?: number;
}) {
  const created: Record<string, unknown>[] = [];
  const find = new FakeQuery(opts.items ?? []);
  const count = new FakeQuery(opts.total ?? 0);
  const populatedQuery = new FakeQuery(opts.populated ?? null);
  const storedQuery = new FakeQuery(opts.stored ?? null);
  class Model {
    constructor(fields: Record<string, unknown>) {
      created.push(fields);
    }
    save = vi.fn().mockResolvedValue({ _id: REMINDER_ID });
    static find = vi.fn().mockReturnValue(find);
    static countDocuments = vi.fn().mockReturnValue(count);
    static findOne = vi
      .fn()
      .mockReturnValue(opts.populated !== undefined ? populatedQuery : storedQuery);
    static findById = vi.fn().mockReturnValue(populatedQuery);
    static deleteOne = vi.fn().mockResolvedValue({ deletedCount: 1 });
    static updateOne = vi.fn().mockResolvedValue({ modifiedCount: 1 });
  }
  return { Model, created, find, populatedQuery };
}

function aService(
  model: unknown,
  parts: { auctions?: object; users?: object; logModel?: unknown } = {},
) {
  return new RemindersService(
    model as Deps[0],
    (parts.logModel ?? {}) as Deps[1],
    (parts.auctions ?? {}) as Deps[2],
    (parts.users ?? {}) as Deps[3],
    new FakeClock(NOW),
  );
}

function createDto(overrides: Partial<CreateReminderDto> = {}): CreateReminderDto {
  return {
    auctionId: 'A1',
    channel: ReminderChannel.EMAIL,
    scheduledAt: '2026-01-16T12:00:00.000Z',
    ...overrides,
  } as CreateReminderDto;
}

function aCreateService(auction: unknown, user: unknown) {
  const { Model } = aModel({ populated: { _id: REMINDER_ID } });
  const auctions = {
    findDocumentByCode: vi.fn().mockResolvedValue(auction),
    findDocumentById: vi.fn().mockResolvedValue(null),
  };
  const users = { findByIdFull: vi.fn().mockResolvedValue(user) };
  return { service: aService(Model, { auctions, users }), auctions, users };
}

describe('RemindersService.create guards', () => {
  it('finds the auction by id when the code does not match', async () => {
    const { Model, created } = aModel({ populated: { _id: REMINDER_ID } });
    const auctions = {
      findDocumentByCode: vi.fn().mockResolvedValue(null),
      findDocumentById: vi.fn().mockResolvedValue(AUCTION),
    };
    const users = { findByIdFull: vi.fn().mockResolvedValue(VERIFIED_USER) };

    await aService(Model, { auctions, users }).create(USER_ID, createDto());

    expect(created[0]?.['auction']).toBe(AUCTION_ID);
  });

  it('refuses an unknown user', async () => {
    const { service } = aCreateService(AUCTION, null);
    await expect(service.create(USER_ID, createDto())).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
  });

  it.each([ReminderChannel.SMS, ReminderChannel.WHATSAPP])(
    'refuses %s on the free plan (BR: premium channels need a paid plan)',
    async (channel) => {
      const { service } = aCreateService(AUCTION, { ...VERIFIED_USER, phone: '+5500000000000' });
      await expect(service.create(USER_ID, createDto({ channel }))).rejects.toEqual(
        new DomainError('REMINDER_CHANNEL_NOT_IN_PLAN', { channel }),
      );
    },
  );

  it.each(['standard', 'premium', 'admin'])('lets the %s role use SMS', async (role) => {
    const { service } = aCreateService(AUCTION, { role, phone: '+5500000000000' });
    await expect(
      service.create(USER_ID, createDto({ channel: ReminderChannel.SMS })),
    ).resolves.toBeDefined();
  });

  it.each([
    ['no e-mail', { role: 'free', emailVerified: true }],
    ['an unverified e-mail', { role: 'free', email: 'a@example.test', emailVerified: false }],
  ])('requires a verified e-mail for the e-mail channel: %s', async (_name, user) => {
    const { service } = aCreateService(AUCTION, user);
    await expect(service.create(USER_ID, createDto())).rejects.toEqual(
      new DomainError('EMAIL_VERIFICATION_REQUIRED'),
    );
  });

  it.each([ReminderChannel.SMS, ReminderChannel.WHATSAPP])(
    'requires a phone for %s',
    async (channel) => {
      const { service } = aCreateService(AUCTION, { role: 'premium' });
      await expect(service.create(USER_ID, createDto({ channel }))).rejects.toEqual(
        new DomainError('PHONE_REQUIRED', { channel }),
      );
    },
  );

  it.each([
    ['has no phases', { _id: AUCTION_ID, phases: [] }],
    ['has no phases field', { _id: AUCTION_ID }],
    ['has a last phase without dates', { _id: AUCTION_ID, phases: [{ phaseDates: [] }] }],
    ['has a last phase with no dates field', { _id: AUCTION_ID, phases: [{}] }],
  ])('refuses an auction that %s', async (_name, auction) => {
    const { service } = aCreateService(auction, VERIFIED_USER);
    await expect(service.create(USER_ID, createDto())).rejects.toEqual(
      new DomainError('AUCTION_START_DATE_MISSING'),
    );
  });

  it('reads the start of the last phase, not the first', async () => {
    const auction = {
      _id: AUCTION_ID,
      phases: [{ phaseDates: ['2026-01-01T13:00:00.000Z'] }, { phaseDates: [START_ISO] }],
    };
    const { service } = aCreateService(auction, VERIFIED_USER);
    // 16/01 is after the first phase's start but before the last one's: accepted.
    await expect(service.create(USER_ID, createDto())).resolves.toBeDefined();
  });

  it('refuses an auction that has already started', async () => {
    const auction = { _id: AUCTION_ID, phases: [{ phaseDates: ['2026-01-15T12:00:00.000Z'] }] };
    const { service } = aCreateService(auction, VERIFIED_USER);
    await expect(service.create(USER_ID, createDto())).rejects.toEqual(
      new DomainError('AUCTION_ALREADY_STARTED'),
    );
  });

  it('fails with REMINDER_NOT_FOUND when the saved reminder vanishes before it is re-read', async () => {
    const { Model } = aModel({ populated: null });
    const auctions = { findDocumentByCode: vi.fn().mockResolvedValue(AUCTION) };
    const users = { findByIdFull: vi.fn().mockResolvedValue(VERIFIED_USER) };
    await expect(aService(Model, { auctions, users }).create(USER_ID, createDto())).rejects.toEqual(
      new DomainError('REMINDER_NOT_FOUND'),
    );
  });
});

describe('RemindersService.findPageByUser', () => {
  it('lists the caller’s reminders soonest first, one page at a time (AR-35)', async () => {
    const items = [{ _id: 'r1' }, { _id: 'r2' }];
    const { Model, find } = aModel({ items, total: 41 });

    const page = await aService(Model).findPageByUser(USER_ID, { page: 3, pageSize: 20 });

    // Page 3 of 20 skips (3 - 1) * 20 = 40 documents.
    expect(page).toEqual({ items, total: 41, page: 3, pageSize: 20 });
    expect(Model.find).toHaveBeenCalledWith({ userId: new Types.ObjectId(USER_ID) });
    expect(Model.countDocuments).toHaveBeenCalledWith({ userId: new Types.ObjectId(USER_ID) });
    expect(find.calls['sort']).toEqual([[{ scheduledAt: 1, _id: 1 }]]);
    expect(find.calls['skip']).toEqual([[40]]);
    expect(find.calls['limit']).toEqual([[20]]);
  });
});

describe('RemindersService.findOne', () => {
  it('returns the caller’s reminder scoped to the owner and the literal id', async () => {
    const reminder = { _id: REMINDER_ID };
    const { Model } = aModel({ populated: reminder });

    await expect(aService(Model).findOne(USER_ID, 'r1')).resolves.toBe(reminder);
    expect(Model.findOne).toHaveBeenCalledWith({
      _id: { $eq: 'r1' },
      userId: new Types.ObjectId(USER_ID),
    });
  });

  it('answers REMINDER_NOT_FOUND for a reminder that is not the caller’s (AR-14)', async () => {
    const { Model } = aModel({ populated: null });
    await expect(aService(Model).findOne(USER_ID, 'r1')).rejects.toEqual(
      new DomainError('REMINDER_NOT_FOUND'),
    );
  });
});

describe('RemindersService.update', () => {
  function anUpdatable(reminder: unknown, parts: { auctions?: object; users?: object } = {}) {
    const { Model } = aModel({ stored: reminder, populated: undefined });
    // `update` loads the reminder with findOne (a plain query), then re-reads it by id populated.
    const reread = { _id: REMINDER_ID, reread: true };
    Model.findById.mockReturnValue(new FakeQuery(reread));
    return { service: aService(Model, parts), Model, reread };
  }

  function aPending(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> & { save: ReturnType<typeof vi.fn> } {
    return {
      _id: REMINDER_ID,
      status: ReminderStatus.PENDING,
      channel: ReminderChannel.EMAIL,
      auction: { toString: () => AUCTION_ID.toHexString() },
      save: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    };
  }

  it('answers REMINDER_NOT_FOUND for a reminder that is not the caller’s', async () => {
    const { service } = anUpdatable(null);
    await expect(service.update(USER_ID, 'r1', {})).rejects.toEqual(
      new DomainError('REMINDER_NOT_FOUND'),
    );
  });

  it('refuses to change a reminder that was already sent', async () => {
    const { service } = anUpdatable(aPending({ status: ReminderStatus.SENT }));
    await expect(service.update(USER_ID, 'r1', { description: 'x' })).rejects.toEqual(
      new DomainError('REMINDER_ALREADY_SENT'),
    );
  });

  it('changes the description (including clearing it) and saves once', async () => {
    const reminder = aPending({ description: 'old' });
    const { service, reread } = anUpdatable(reminder);

    await expect(service.update(USER_ID, 'r1', { description: '' })).resolves.toBe(reread);

    expect(reminder['description']).toBe('');
    expect(reminder.save).toHaveBeenCalledTimes(1);
  });

  it('leaves the description alone when the update does not mention it', async () => {
    const reminder = aPending({ description: 'keep' });
    const { service } = anUpdatable(reminder);

    await service.update(USER_ID, 'r1', {});

    expect(reminder['description']).toBe('keep');
  });

  it('ignores a channel equal to the current one', async () => {
    const reminder = aPending();
    const users = { findByIdFull: vi.fn() };
    const { service } = anUpdatable(reminder, { users });

    await service.update(USER_ID, 'r1', { channel: ReminderChannel.EMAIL });

    expect(users.findByIdFull).not.toHaveBeenCalled();
  });

  it('switches channel after checking plan and contact info', async () => {
    const reminder = aPending();
    const users = { findByIdFull: vi.fn().mockResolvedValue({ role: 'premium', phone: '+55' }) };
    const { service } = anUpdatable(reminder, { users });

    await service.update(USER_ID, 'r1', { channel: ReminderChannel.SMS });

    expect(reminder['channel']).toBe(ReminderChannel.SMS);
  });

  it('refuses a channel switch for an unknown user', async () => {
    const users = { findByIdFull: vi.fn().mockResolvedValue(null) };
    const { service } = anUpdatable(aPending(), { users });
    await expect(service.update(USER_ID, 'r1', { channel: ReminderChannel.SMS })).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
  });

  it('refuses a channel switch the plan does not allow, leaving the reminder unsaved', async () => {
    const reminder = aPending();
    const users = { findByIdFull: vi.fn().mockResolvedValue({ role: 'free', phone: '+55' }) };
    const { service } = anUpdatable(reminder, { users });

    await expect(
      service.update(USER_ID, 'r1', { channel: ReminderChannel.WHATSAPP }),
    ).rejects.toEqual(
      new DomainError('REMINDER_CHANNEL_NOT_IN_PLAN', { channel: ReminderChannel.WHATSAPP }),
    );
    expect(reminder.save).not.toHaveBeenCalled();
  });

  it('reschedules to the new time, rounded to a quarter hour, before the auction start', async () => {
    const reminder = aPending();
    const auctions = { findDocumentById: vi.fn().mockResolvedValue(AUCTION) };
    const { service } = anUpdatable(reminder, { auctions });

    await service.update(USER_ID, 'r1', { scheduledAt: '2026-01-16T12:07:00.000Z' });

    // 12:07 rounds down to 12:00 (7 < 7.5 minutes).
    expect(reminder['scheduledAt']).toEqual(new Date('2026-01-16T12:00:00.000Z'));
  });

  it('refuses to reschedule when the auction was removed', async () => {
    const auctions = { findDocumentById: vi.fn().mockResolvedValue(null) };
    const { service } = anUpdatable(aPending(), { auctions });
    await expect(
      service.update(USER_ID, 'r1', { scheduledAt: '2026-01-16T12:00:00.000Z' }),
    ).rejects.toEqual(new DomainError('AUCTION_NOT_FOUND'));
  });

  it('refuses to reschedule against an auction with no start date', async () => {
    const auctions = {
      findDocumentById: vi.fn().mockResolvedValue({ _id: AUCTION_ID, phases: [] }),
    };
    const { service } = anUpdatable(aPending(), { auctions });
    await expect(
      service.update(USER_ID, 'r1', { scheduledAt: '2026-01-16T12:00:00.000Z' }),
    ).rejects.toEqual(new DomainError('AUCTION_START_DATE_MISSING'));
  });

  it('fails with REMINDER_NOT_FOUND when the saved reminder vanishes before the re-read', async () => {
    const { service, Model } = anUpdatable(aPending());
    Model.findById.mockReturnValue(new FakeQuery(null));
    await expect(service.update(USER_ID, 'r1', {})).rejects.toEqual(
      new DomainError('REMINDER_NOT_FOUND'),
    );
  });
});

describe('RemindersService.delete', () => {
  function aDeletable(reminder: unknown) {
    const { Model } = aModel({ stored: reminder, populated: undefined });
    return { service: aService(Model), Model };
  }

  it('deletes a pending reminder of the caller', async () => {
    const { service, Model } = aDeletable({ status: ReminderStatus.PENDING });

    await service.delete(USER_ID, 'r1');

    expect(Model.findOne).toHaveBeenCalledWith({
      _id: { $eq: 'r1' },
      userId: new Types.ObjectId(USER_ID),
    });
    expect(Model.deleteOne).toHaveBeenCalledWith({ _id: { $eq: 'r1' } });
  });

  it('answers REMINDER_NOT_FOUND for a reminder that is not the caller’s', async () => {
    const { service, Model } = aDeletable(null);
    await expect(service.delete(USER_ID, 'r1')).rejects.toEqual(
      new DomainError('REMINDER_NOT_FOUND'),
    );
    expect(Model.deleteOne).not.toHaveBeenCalled();
  });

  it('keeps a reminder that was already sent', async () => {
    const { service, Model } = aDeletable({ status: ReminderStatus.SENT });
    await expect(service.delete(USER_ID, 'r1')).rejects.toEqual(
      new DomainError('REMINDER_ALREADY_SENT'),
    );
    expect(Model.deleteOne).not.toHaveBeenCalled();
  });
});

describe('RemindersService delivery bookkeeping', () => {
  it('marks a reminder as sent by its literal id', async () => {
    const { Model } = aModel({});

    await aService(Model).markAsSent('r1');

    expect(Model.updateOne).toHaveBeenCalledWith(
      { _id: { $eq: 'r1' } },
      { status: ReminderStatus.SENT },
    );
  });

  it('logs a notification with the recipient and the provider outcome', async () => {
    const saved: Record<string, unknown>[] = [];
    class LogModel {
      constructor(fields: Record<string, unknown>) {
        saved.push(fields);
      }
      save = vi.fn().mockResolvedValue(undefined);
    }
    const { Model } = aModel({});

    await aService(Model, { logModel: LogModel }).logNotification(
      REMINDER_ID.toHexString(),
      USER_ID,
      ReminderChannel.SMS,
      '+5500000000000',
      false,
      '21211',
    );

    expect(saved).toEqual([
      {
        reminderId: REMINDER_ID,
        userId: new Types.ObjectId(USER_ID),
        channel: ReminderChannel.SMS,
        recipient: '+5500000000000',
        success: false,
        errorMessage: '21211',
      },
    ]);
  });
});
