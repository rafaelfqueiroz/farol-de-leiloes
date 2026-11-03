import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../common/errors/domain-error';
import { RemindersService } from './reminders.service';
import type { CreateReminderDto } from './dto/create-reminder.dto';

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
