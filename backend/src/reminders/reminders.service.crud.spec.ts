import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { DomainError } from '../common/errors/domain-error.js';
import { RemindersService } from './reminders.service.js';
import { ReminderChannel, ReminderStatus } from './schemas/reminder.schema.js';
import type { CreateReminderDto } from './dto/create-reminder.dto.js';
import { FakeClock } from '../../test/fakes/fake-clock.js';
import { anAccessContext } from '../../test/fakes/fake-access-sources.js';

type Deps = ConstructorParameters<typeof RemindersService>;

const NOW = new Date('2026-01-15T12:00:00.000Z');
const USER_ID = '64b000000000000000000002';
const AUCTION_ID = new Types.ObjectId('64b000000000000000000001');
const REMINDER_ID = new Types.ObjectId('64b000000000000000000003');
const START_ISO = '2026-01-20T13:00:00.000Z';
const AUCTION = { _id: AUCTION_ID, phases: [{ phaseDates: [START_ISO] }] };
const VERIFIED_USER = { role: 'free', email: 'a@example.test', emailVerified: true };
const ctx = await anAccessContext(USER_ID);

/**
 * A stand-in for RemindersRepository (TS-03: the service's port to the reminder model): every
 * method a spy with an answer. The account scoping itself is the repository's, proven against
 * MongoDB in test/integration/operator-injection.spec.ts and through the API in
 * test/isolation/reminders.isolation.spec.ts.
 */
function aRepository(
  opts: { stored?: unknown; populated?: unknown; items?: unknown[]; total?: number } = {},
) {
  return {
    create: vi.fn().mockResolvedValue({ _id: REMINDER_ID }),
    count: vi.fn().mockResolvedValue(opts.total ?? 0),
    findPopulatedPage: vi.fn().mockResolvedValue(opts.items ?? []),
    findPopulatedById: vi.fn().mockResolvedValue(opts.populated ?? null),
    findById: vi.fn().mockResolvedValue(opts.stored ?? null),
    updateById: vi.fn().mockResolvedValue({}),
    deleteById: vi.fn().mockResolvedValue(undefined),
    markSentAcrossAccounts: vi.fn().mockResolvedValue(undefined),
  };
}

function aService(
  repository: unknown,
  parts: { auctions?: object; users?: object; logs?: unknown } = {},
) {
  return new RemindersService(
    repository as Deps[0],
    (parts.logs ?? {}) as Deps[1],
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
  const repository = aRepository({ populated: { _id: REMINDER_ID } });
  const auctions = {
    findDocumentByCode: vi.fn().mockResolvedValue(auction),
    findDocumentById: vi.fn().mockResolvedValue(null),
  };
  const users = { findByIdFull: vi.fn().mockResolvedValue(user) };
  return { service: aService(repository, { auctions, users }), auctions, users, repository };
}

describe('RemindersService.create guards', () => {
  it('finds the auction by id when the code does not match', async () => {
    const repository = aRepository({ populated: { _id: REMINDER_ID } });
    const auctions = {
      findDocumentByCode: vi.fn().mockResolvedValue(null),
      findDocumentById: vi.fn().mockResolvedValue(AUCTION),
    };
    const users = { findByIdFull: vi.fn().mockResolvedValue(VERIFIED_USER) };

    await aService(repository, { auctions, users }).create(ctx, createDto());

    expect(repository.create).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({ auction: AUCTION_ID }),
    );
    // SPEC-002: the user whose plan and contacts count is the context's account.
    expect(users.findByIdFull).toHaveBeenCalledWith(USER_ID);
  });

  it('refuses an unknown user', async () => {
    const { service } = aCreateService(AUCTION, null);
    await expect(service.create(ctx, createDto())).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
  });

  it.each([ReminderChannel.SMS, ReminderChannel.WHATSAPP])(
    'refuses %s on the free plan (BR: premium channels need a paid plan)',
    async (channel) => {
      const { service } = aCreateService(AUCTION, { ...VERIFIED_USER, phone: '+5500000000000' });
      await expect(service.create(ctx, createDto({ channel }))).rejects.toEqual(
        new DomainError('REMINDER_CHANNEL_NOT_IN_PLAN', { channel }),
      );
    },
  );

  it.each(['standard', 'premium'])('lets the %s role use SMS', async (role) => {
    const { service } = aCreateService(AUCTION, { role, phone: '+5500000000000' });
    await expect(
      service.create(ctx, createDto({ channel: ReminderChannel.SMS })),
    ).resolves.toBeDefined();
  });

  it('SPEC-002 BR-002-23: the legacy admin role is no plan, so it cannot use SMS', async () => {
    const { service } = aCreateService(AUCTION, {
      role: 'admin',
      isAdmin: true,
      phone: '+5500000000000',
    });
    await expect(service.create(ctx, createDto({ channel: ReminderChannel.SMS }))).rejects.toEqual(
      new DomainError('REMINDER_CHANNEL_NOT_IN_PLAN', { channel: ReminderChannel.SMS }),
    );
  });

  it.each([
    ['no e-mail', { role: 'free', emailVerified: true }],
    ['an unverified e-mail', { role: 'free', email: 'a@example.test', emailVerified: false }],
  ])('requires a verified e-mail for the e-mail channel: %s', async (_name, user) => {
    const { service } = aCreateService(AUCTION, user);
    await expect(service.create(ctx, createDto())).rejects.toEqual(
      new DomainError('EMAIL_VERIFICATION_REQUIRED'),
    );
  });

  it.each([ReminderChannel.SMS, ReminderChannel.WHATSAPP])(
    'requires a phone for %s',
    async (channel) => {
      const { service } = aCreateService(AUCTION, { role: 'premium' });
      await expect(service.create(ctx, createDto({ channel }))).rejects.toEqual(
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
    await expect(service.create(ctx, createDto())).rejects.toEqual(
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
    await expect(service.create(ctx, createDto())).resolves.toBeDefined();
  });

  it('refuses an auction that has already started', async () => {
    const auction = { _id: AUCTION_ID, phases: [{ phaseDates: ['2026-01-15T12:00:00.000Z'] }] };
    const { service } = aCreateService(auction, VERIFIED_USER);
    await expect(service.create(ctx, createDto())).rejects.toEqual(
      new DomainError('AUCTION_ALREADY_STARTED'),
    );
  });

  it('fails with REMINDER_NOT_FOUND when the saved reminder vanishes before it is re-read', async () => {
    const repository = aRepository({ populated: null });
    const auctions = { findDocumentByCode: vi.fn().mockResolvedValue(AUCTION) };
    const users = { findByIdFull: vi.fn().mockResolvedValue(VERIFIED_USER) };
    await expect(
      aService(repository, { auctions, users }).create(ctx, createDto()),
    ).rejects.toEqual(new DomainError('REMINDER_NOT_FOUND'));
  });
});

describe('RemindersService.findPageByUser', () => {
  it('lists the caller’s reminders soonest first, one page at a time (AR-35)', async () => {
    const items = [{ _id: 'r1' }, { _id: 'r2' }];
    const repository = aRepository({ items, total: 41 });

    const page = await aService(repository).findPageByUser(ctx, { page: 3, pageSize: 20 });

    expect(page).toEqual({ items, total: 41, page: 3, pageSize: 20 });
    expect(repository.count).toHaveBeenCalledWith(ctx);
    expect(repository.findPopulatedPage).toHaveBeenCalledWith(ctx, { page: 3, pageSize: 20 });
  });
});

describe('RemindersService.findOne', () => {
  it('returns the caller’s reminder scoped to the owner and the literal id', async () => {
    const reminder = { _id: REMINDER_ID };
    const repository = aRepository({ populated: reminder });

    await expect(aService(repository).findOne(ctx, 'r1')).resolves.toBe(reminder);
    expect(repository.findPopulatedById).toHaveBeenCalledWith(ctx, 'r1');
  });

  it('answers REMINDER_NOT_FOUND for a reminder that is not the caller’s (AR-14)', async () => {
    const repository = aRepository({ populated: null });
    await expect(aService(repository).findOne(ctx, 'r1')).rejects.toEqual(
      new DomainError('REMINDER_NOT_FOUND'),
    );
  });
});

describe('RemindersService.update', () => {
  function anUpdatable(reminder: unknown, parts: { auctions?: object; users?: object } = {}) {
    // `update` loads the reminder (plain), writes the changes, then re-reads it populated.
    const reread = { _id: REMINDER_ID, reread: true };
    const repository = aRepository({ stored: reminder, populated: reread });
    return { service: aService(repository, parts), repository, reread };
  }

  function aPending(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      _id: REMINDER_ID,
      status: ReminderStatus.PENDING,
      channel: ReminderChannel.EMAIL,
      auction: { toString: () => AUCTION_ID.toHexString() },
      ...overrides,
    };
  }

  // The one conditional write: still the account's and still pending.
  const STILL_PENDING = { status: { $eq: ReminderStatus.PENDING } };

  it('answers REMINDER_NOT_FOUND for a reminder that is not the caller’s', async () => {
    const { service } = anUpdatable(null);
    await expect(service.update(ctx, 'r1', {})).rejects.toEqual(
      new DomainError('REMINDER_NOT_FOUND'),
    );
  });

  it('refuses to change a reminder that was already sent', async () => {
    const { service } = anUpdatable(aPending({ status: ReminderStatus.SENT }));
    await expect(service.update(ctx, 'r1', { description: 'x' })).rejects.toEqual(
      new DomainError('REMINDER_ALREADY_SENT'),
    );
  });

  it('changes the description (including clearing it) and saves once', async () => {
    const { service, repository, reread } = anUpdatable(aPending({ description: 'old' }));

    await expect(service.update(ctx, 'r1', { description: '' })).resolves.toBe(reread);

    expect(repository.updateById).toHaveBeenCalledTimes(1);
    expect(repository.updateById).toHaveBeenCalledWith(
      ctx,
      'r1',
      { description: '' },
      STILL_PENDING,
    );
  });

  it('leaves the description alone when the update does not mention it', async () => {
    const { service, repository, reread } = anUpdatable(aPending({ description: 'keep' }));

    await expect(service.update(ctx, 'r1', {})).resolves.toBe(reread);

    expect(repository.updateById).not.toHaveBeenCalled();
  });

  it('ignores a channel equal to the current one', async () => {
    const users = { findByIdFull: vi.fn() };
    const { service, repository } = anUpdatable(aPending(), { users });

    await service.update(ctx, 'r1', { channel: ReminderChannel.EMAIL });

    expect(users.findByIdFull).not.toHaveBeenCalled();
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  it('switches channel after checking plan and contact info', async () => {
    const users = { findByIdFull: vi.fn().mockResolvedValue({ role: 'premium', phone: '+55' }) };
    const { service, repository } = anUpdatable(aPending(), { users });

    await service.update(ctx, 'r1', { channel: ReminderChannel.SMS });

    expect(users.findByIdFull).toHaveBeenCalledWith(USER_ID);
    expect(repository.updateById).toHaveBeenCalledWith(
      ctx,
      'r1',
      { channel: ReminderChannel.SMS },
      STILL_PENDING,
    );
  });

  it('refuses a channel switch for an unknown user', async () => {
    const users = { findByIdFull: vi.fn().mockResolvedValue(null) };
    const { service } = anUpdatable(aPending(), { users });
    await expect(service.update(ctx, 'r1', { channel: ReminderChannel.SMS })).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );
  });

  it('refuses a channel switch the plan does not allow, leaving the reminder unsaved', async () => {
    const users = { findByIdFull: vi.fn().mockResolvedValue({ role: 'free', phone: '+55' }) };
    const { service, repository } = anUpdatable(aPending(), { users });

    await expect(service.update(ctx, 'r1', { channel: ReminderChannel.WHATSAPP })).rejects.toEqual(
      new DomainError('REMINDER_CHANNEL_NOT_IN_PLAN', { channel: ReminderChannel.WHATSAPP }),
    );
    expect(repository.updateById).not.toHaveBeenCalled();
  });

  it('reschedules to the new time, rounded to a quarter hour, before the auction start', async () => {
    const auctions = { findDocumentById: vi.fn().mockResolvedValue(AUCTION) };
    const { service, repository } = anUpdatable(aPending(), { auctions });

    await service.update(ctx, 'r1', { scheduledAt: '2026-01-16T12:07:00.000Z' });

    // 12:07 rounds down to 12:00 (7 < 7.5 minutes).
    expect(repository.updateById).toHaveBeenCalledWith(
      ctx,
      'r1',
      { scheduledAt: new Date('2026-01-16T12:00:00.000Z') },
      STILL_PENDING,
    );
  });

  it('refuses to reschedule when the auction was removed', async () => {
    const auctions = { findDocumentById: vi.fn().mockResolvedValue(null) };
    const { service } = anUpdatable(aPending(), { auctions });
    await expect(
      service.update(ctx, 'r1', { scheduledAt: '2026-01-16T12:00:00.000Z' }),
    ).rejects.toEqual(new DomainError('AUCTION_NOT_FOUND'));
  });

  it('refuses to reschedule against an auction with no start date', async () => {
    const auctions = {
      findDocumentById: vi.fn().mockResolvedValue({ _id: AUCTION_ID, phases: [] }),
    };
    const { service } = anUpdatable(aPending(), { auctions });
    await expect(
      service.update(ctx, 'r1', { scheduledAt: '2026-01-16T12:00:00.000Z' }),
    ).rejects.toEqual(new DomainError('AUCTION_START_DATE_MISSING'));
  });

  it('fails with REMINDER_NOT_FOUND when the saved reminder vanishes before the re-read', async () => {
    const { service, repository } = anUpdatable(aPending());
    repository.findPopulatedById.mockResolvedValue(null);
    await expect(service.update(ctx, 'r1', {})).rejects.toEqual(
      new DomainError('REMINDER_NOT_FOUND'),
    );
  });
});

describe('RemindersService.delete', () => {
  function aDeletable(reminder: unknown) {
    const repository = aRepository({ stored: reminder });
    return { service: aService(repository), repository };
  }

  it('deletes a pending reminder of the caller, only while it is still pending', async () => {
    const { service, repository } = aDeletable({ status: ReminderStatus.PENDING });

    await service.delete(ctx, 'r1');

    expect(repository.findById).toHaveBeenCalledWith(ctx, 'r1');
    expect(repository.deleteById).toHaveBeenCalledWith(ctx, 'r1', {
      status: { $eq: ReminderStatus.PENDING },
    });
  });

  it('answers REMINDER_NOT_FOUND for a reminder that is not the caller’s', async () => {
    const { service, repository } = aDeletable(null);
    await expect(service.delete(ctx, 'r1')).rejects.toEqual(new DomainError('REMINDER_NOT_FOUND'));
    expect(repository.deleteById).not.toHaveBeenCalled();
  });

  it('keeps a reminder that was already sent', async () => {
    const { service, repository } = aDeletable({ status: ReminderStatus.SENT });
    await expect(service.delete(ctx, 'r1')).rejects.toEqual(
      new DomainError('REMINDER_ALREADY_SENT'),
    );
    expect(repository.deleteById).not.toHaveBeenCalled();
  });
});

describe('RemindersService delivery bookkeeping', () => {
  it('marks a reminder as sent through the named cross-account method (AR-12)', async () => {
    const repository = aRepository();

    await aService(repository).markAsSent('r1');

    expect(repository.markSentAcrossAccounts).toHaveBeenCalledWith('r1');
  });

  it('logs a notification for the reminder’s own account (BR-002-29)', async () => {
    const logs = { recordDeliveryByJob: vi.fn().mockResolvedValue(undefined) };

    await aService(aRepository(), { logs }).logNotification(
      REMINDER_ID.toHexString(),
      USER_ID,
      ReminderChannel.SMS,
      '+5500000000000',
      false,
      '21211',
    );

    expect(logs.recordDeliveryByJob).toHaveBeenCalledWith(USER_ID, {
      reminderId: REMINDER_ID.toHexString(),
      channel: ReminderChannel.SMS,
      recipient: '+5500000000000',
      success: false,
      errorMessage: '21211',
    });
  });
});
