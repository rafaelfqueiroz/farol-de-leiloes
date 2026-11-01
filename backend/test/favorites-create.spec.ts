import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FavoritesService } from '../src/favorites/favorites.service';

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
      findDocumentByCode: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      // findByCode only returns available auctions
      findByCode: jest.fn().mockResolvedValue(null),
    };
    const service = new FavoritesService(
      FakeFavoriteModel as unknown as ServiceDeps[0],
      auctionsService as unknown as ServiceDeps[1],
    );

    await expect(service.create('user-1', 'A1')).rejects.toBeInstanceOf(NotFoundException);
    expect(saved).toHaveLength(1);
  });
});
