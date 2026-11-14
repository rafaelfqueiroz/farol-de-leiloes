import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { FavoritesService } from './favorites.service.js';
import { DomainError } from '../common/errors/domain-error.js';

type ServiceDeps = ConstructorParameters<typeof FavoritesService>;

describe('FavoritesService.create', () => {
  it('reports an auction that is no longer available as not found instead of returning null (DV-03)', async () => {
    const saved: unknown[] = [];
    class FakeFavoriteModel {
      constructor(private readonly data: unknown) {}
      static findOne() {
        return { exec: async () => null };
      }
      async save() {
        saved.push(this.data);
        return this;
      }
    }
    const auctionsService = {
      findDocumentByCode: vi.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      // findByCode only returns available auctions
      findByCode: vi.fn().mockResolvedValue(null),
    };
    const service = new FavoritesService(
      FakeFavoriteModel as unknown as ServiceDeps[0],
      auctionsService as unknown as ServiceDeps[1],
    );

    await expect(service.create('user-1', 'A1')).rejects.toEqual(
      new DomainError('AUCTION_NOT_FOUND'),
    );
    expect(saved).toHaveLength(1);
  });
});

// SC-10: both values are compared by equality, and a non-string is "not a favorite".
describe('FavoritesService.findOne (SC-10)', () => {
  function build(found: unknown = null) {
    const model = {
      findOne: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(found) }),
    };
    const service = new FavoritesService(model as unknown as ServiceDeps[0], {} as ServiceDeps[1]);
    return { service, model };
  }

  it('compares the user and the auction code by equality', async () => {
    const favorite = { auctionCode: 'A1' };
    const { service, model } = build(favorite);

    await expect(service.findOne('user-1', 'A1')).resolves.toBe(favorite);
    expect(model.findOne).toHaveBeenCalledWith({
      userId: { $eq: 'user-1' },
      auctionCode: { $eq: 'A1' },
    });
  });

  it.each([
    ['userId', { $ne: null }, 'A1'],
    ['auctionCode', 'user-1', { $ne: null }],
  ])('finds nothing, and never queries, for an object %s', async (_field, userId, code) => {
    const { service, model } = build({ auctionCode: 'A1' });

    await expect(service.findOne(userId as string, code as string)).resolves.toBeNull();
    expect(model.findOne).not.toHaveBeenCalled();
  });
});
