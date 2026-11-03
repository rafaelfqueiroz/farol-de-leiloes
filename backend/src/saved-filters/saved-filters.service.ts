import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SavedFilterEntity, SavedFilterDocument, FilterData } from './schemas/saved-filter.schema';
import { SavedFilter } from './interfaces/saved-filter.interface';
import { DomainError } from '../common/errors/domain-error';
import {
  type PageRequest,
  type Paginated,
  paginated,
  skipOf,
} from '../common/pagination/paginated';

const MAX_SAVED_FILTERS = 10;

@Injectable()
export class SavedFiltersService {
  constructor(
    @InjectModel(SavedFilterEntity.name)
    private readonly savedFilterRepository: Model<SavedFilterDocument>,
  ) {}

  /** AR-35: one page of the user's saved filters, newest first (`_id` breaks createdAt ties). */
  async findPage(userId: string, page: PageRequest): Promise<Paginated<SavedFilter>> {
    const [total, docs] = await Promise.all([
      this.savedFilterRepository.countDocuments({ userId }).exec(),
      this.savedFilterRepository
        .find({ userId })
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
    // Check if user has reached the limit
    const count = await this.savedFilterRepository.countDocuments({ userId });
    if (count >= MAX_SAVED_FILTERS) {
      throw new DomainError('SAVED_FILTER_LIMIT_REACHED', { limit: MAX_SAVED_FILTERS });
    }

    // Check for duplicate name. AR-40: the name is the user's text, so it stays out of the error.
    const existing = await this.savedFilterRepository.findOne({ userId, name });
    if (existing) {
      throw new DomainError('SAVED_FILTER_NAME_TAKEN');
    }

    const savedFilter = new this.savedFilterRepository({
      userId,
      name,
      filters,
    });

    const saved = await savedFilter.save();
    return this.toSavedFilter(saved);
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.savedFilterRepository.deleteOne({ _id: id, userId }).exec();

    if (result.deletedCount === 0) {
      throw new DomainError('SAVED_FILTER_NOT_FOUND');
    }

    return true;
  }

  private toSavedFilter(doc: SavedFilterDocument): SavedFilter {
    return {
      _id: doc._id.toString(),
      name: doc.name,
      filters: doc.filters,
      createdAt: doc.createdAt,
    };
  }
}
