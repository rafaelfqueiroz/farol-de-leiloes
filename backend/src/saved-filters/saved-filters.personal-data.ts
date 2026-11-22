// SPEC-010 BR-010-08, BR-010-09, BR-010-15 / SC-27: what the saved-filters module holds about an
// account, for the export, the "my data" view and the purge (AR-09: through its own repository).
import { Injectable } from '@nestjs/common';
import type { AccessContext } from '../access/access-context.js';
import { fromDecimal128OrNull } from '../common/money/decimal128.js';
import { moneyToJson } from '../common/money/money-dto.js';
import { listSection } from '../privacy/domain/export-document.js';
import { PersonalDataRegistry } from '../privacy/registry/personal-data-registry.js';
import type {
  CollectOptions,
  PersonalDataProvider,
} from '../privacy/registry/personal-data-provider.js';
import { SavedFiltersRepository } from './saved-filters.repository.js';
import { SavedFilterEntity } from './schemas/saved-filter.schema.js';

@Injectable()
export class SavedFiltersPersonalData implements PersonalDataProvider {
  readonly name = 'savedFilters';
  readonly models = [SavedFilterEntity.name];

  constructor(
    registry: PersonalDataRegistry,
    private readonly savedFilters: SavedFiltersRepository,
  ) {
    registry.register(this);
  }

  async collect(ctx: AccessContext, options?: CollectOptions): Promise<Record<string, unknown>> {
    const { items: found, total } = await this.savedFilters.findAllForExport(ctx, options?.limit);
    return listSection(
      found.map((saved) => {
        // A filter saved with no criteria is stored without its `filters` path (Mongoose drops an
        // empty object): the export shows it as empty, never fails on it.
        const filters = saved.filters ?? {};
        return {
          name: saved.name,
          filters: {
            state: filters.state,
            city: filters.city,
            neighborhood: filters.neighborhood,
            modality: filters.modality,
            // AR-17: the price bounds are strings, never a JS number.
            minPrice: moneyToJson(fromDecimal128OrNull(filters.minPrice)),
            maxPrice: moneyToJson(fromDecimal128OrNull(filters.maxPrice)),
          },
          createdAt: saved.createdAt,
        };
      }),
      total,
    );
  }

  async purge(userId: string): Promise<{ deleted: number }> {
    return { deleted: await this.savedFilters.purgeAccountByJob(userId) };
  }
}
