import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { AccessContext } from '../access/access-context.js';
import { StoredFilterData } from './schemas/saved-filter.schema.js';
import { SavedFiltersRepository, type SavedFilterRecord } from './saved-filters.repository.js';
import { FilterData, SavedFilter } from './interfaces/saved-filter.interface.js';
import businessConfig from '../config/business.config.js';
import { DomainError } from '../common/errors/domain-error.js';
import { fromDecimal128OrNull, toDecimal128 } from '../common/money/decimal128.js';
import { type PageRequest, type Paginated, paginated } from '../common/pagination/paginated.js';

@Injectable()
export class SavedFiltersService {
  constructor(
    // AR-08 / SPEC-002 BR-002-02: the account's own data, through its account-scoped repository.
    private readonly savedFilters: SavedFiltersRepository,
    @Inject(businessConfig.KEY)
    private readonly config: ConfigType<typeof businessConfig>,
  ) {}

  /** AR-35: one page of the account's saved filters, newest first (`_id` breaks createdAt ties). */
  async findPage(ctx: AccessContext, page: PageRequest): Promise<Paginated<SavedFilter>> {
    const [total, docs] = await Promise.all([
      this.savedFilters.count(ctx),
      this.savedFilters.findPage(ctx, page),
    ]);
    return paginated(
      docs.map((doc) => this.toSavedFilter(doc)),
      total,
      page,
    );
  }

  async create(ctx: AccessContext, name: string, filters: FilterData): Promise<SavedFilter> {
    // AR-43: the limit is a setting (SAVED_FILTERS_MAX_PER_USER), not a constant here.
    const { maxPerUser } = this.config.savedFilters;
    const count = await this.savedFilters.count(ctx);
    if (count >= maxPerUser) {
      throw new DomainError('SAVED_FILTER_LIMIT_REACHED', { limit: maxPerUser });
    }

    // Check for duplicate name. AR-40: the name is the user's text, so it stays out of the error.
    // SC-10: equality only; the name is the user's text and never an operator.
    const existing = await this.savedFilters.findByName(ctx, name);
    if (existing) {
      throw new DomainError('SAVED_FILTER_NAME_TAKEN');
    }

    const saved = await this.savedFilters.create(ctx, {
      name,
      filters: toStoredFilterData(filters),
    });
    return this.toSavedFilter(saved);
  }

  /** SAVED_FILTER_NOT_FOUND alike for another account's, a missing and a malformed id (AR-14). */
  async delete(ctx: AccessContext, id: string): Promise<boolean> {
    await this.savedFilters.deleteById(ctx, id);
    return true;
  }

  private toSavedFilter(doc: SavedFilterRecord): SavedFilter {
    return {
      _id: doc._id.toString(),
      name: doc.name,
      filters: fromStoredFilterData(doc.filters),
      createdAt: doc.createdAt,
    };
  }
}

/** AR-17: the price bounds are written as Decimal128. */
function toStoredFilterData(filters: FilterData): StoredFilterData {
  const { minPrice, maxPrice, ...criteria } = filters;
  const stored: StoredFilterData = { ...criteria };
  if (minPrice !== undefined) stored.minPrice = toDecimal128(minPrice);
  if (maxPrice !== undefined) stored.maxPrice = toDecimal128(maxPrice);
  return stored;
}

function fromStoredFilterData(stored: StoredFilterData): FilterData {
  const { minPrice, maxPrice, ...criteria } = stored;
  const filters: FilterData = { ...criteria };
  const min = fromDecimal128OrNull(minPrice);
  const max = fromDecimal128OrNull(maxPrice);
  if (min !== null) filters.minPrice = min;
  if (max !== null) filters.maxPrice = max;
  return filters;
}
