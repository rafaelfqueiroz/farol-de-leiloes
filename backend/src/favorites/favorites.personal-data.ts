// SPEC-010 BR-010-08, BR-010-09, BR-010-15 / SC-27: what the favorites module holds about an account,
// for the export, the "my data" view and the purge. Registered when the module is built (AR-09: it
// reads and deletes through the module's own repository).
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../access/access-context.js';
import { PersonalDataRegistry } from '../privacy/registry/personal-data-registry.js';
import type { PersonalDataProvider } from '../privacy/registry/personal-data-provider.js';
import { FavoritesRepository } from './favorites.repository.js';
import { FavoriteEntity } from './schemas/favorite.schema.js';

@Injectable()
export class FavoritesPersonalData implements PersonalDataProvider {
  readonly name = 'favorites';
  readonly models = [FavoriteEntity.name];

  constructor(
    registry: PersonalDataRegistry,
    private readonly favorites: FavoritesRepository,
  ) {
    registry.register(this);
  }

  async collect(ctx: AccessContext): Promise<Record<string, unknown>> {
    const found = await this.favorites.findAllForExport(ctx);
    return {
      items: found.map((favorite) => ({
        auctionCode: favorite.auctionCode,
        addedAt: favorite.createdAt ?? null,
      })),
    };
  }

  async purge(userId: string): Promise<{ deleted: number }> {
    return { deleted: await this.favorites.purgeAccountByJob(userId) };
  }
}
