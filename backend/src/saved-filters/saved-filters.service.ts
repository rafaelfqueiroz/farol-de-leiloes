import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  SavedFilterEntity,
  SavedFilterDocument,
  StoredFilterData,
} from './schemas/saved-filter.schema.js';
import { FilterData, SavedFilter } from './interfaces/saved-filter.interface.js';
import businessConfig from '../config/business.config.js';
import { DomainError } from '../common/errors/domain-error.js';
import { fromDecimal128OrNull, toDecimal128 } from '../common/money/decimal128.js';
import {
  type PageRequest,
  type Paginated,
  paginated,
  skipOf,
} from '../common/pagination/paginated.js';

@Injectable()
export class SavedFiltersService {
  constructor(
    @InjectModel(SavedFilterEntity.name)
    private readonly savedFilterRepository: Model<SavedFilterDocument>,
    @Inject(businessConfig.KEY)
    private readonly config: ConfigType<typeof businessConfig>,
  ) {}

  /** AR-35: one page of the user's saved filters, newest first (`_id` breaks createdAt ties). */
  async findPage(userId: string, page: PageRequest): Promise<Paginated<SavedFilter>> {
    const [total, docs] = await Promise.all([
      this.savedFilterRepository.countDocuments({ userId: { $eq: userId } }).exec(),
      this.savedFilterRepository
        .find({ userId: { $eq: userId } })
        .sort({ createdAt: -1, _id: -1 })
        .skip(skipOf(page))
        .limit(page.pageSize)
        .exec(),
    ]);
    return paginated(
      docs.map((doc) => this.toSavedFilter(doc)),
      total,
      page,
    );
  }

  async create(userId: string, name: string, filters: FilterData): Promise<SavedFilter> {
    // AR-43: the limit is a setting (SAVED_FILTERS_MAX_PER_USER), not a constant here.
    const { maxPerUser } = this.config.savedFilters;
    const count = await this.savedFilterRepository.countDocuments({ userId: { $eq: userId } });
    if (count >= maxPerUser) {
      throw new DomainError('SAVED_FILTER_LIMIT_REACHED', { limit: maxPerUser });
    }

    // Check for duplicate name. AR-40: the name is the user's text, so it stays out of the error.
    // SC-10: equality only; the name is the user's text and never an operator.
    const existing = await this.savedFilterRepository.findOne({
      userId: { $eq: userId },
      name: { $eq: name },
    });
    if (existing) {
      throw new DomainError('SAVED_FILTER_NAME_TAKEN');
    }

    const savedFilter = new this.savedFilterRepository({
      userId,
      name,
      filters: toStoredFilterData(filters),
    });

    const saved = await savedFilter.save();
    return this.toSavedFilter(saved);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.savedFilterRepository
      .deleteOne({ _id: { $eq: id }, userId: { $eq: userId } })
      .exec();

    if (result.deletedCount === 0) {
      throw new DomainError('SAVED_FILTER_NOT_FOUND');
    }

    return true;
  }

  private toSavedFilter(doc: SavedFilterDocument): SavedFilter {
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
