import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SavedFilterEntity, SavedFilterDocument, FilterData } from './schemas/saved-filter.schema';
import { SavedFilter } from './interfaces/saved-filter.interface';

const MAX_SAVED_FILTERS = 10;

@Injectable()
export class SavedFiltersService {
  constructor(
    @InjectModel(SavedFilterEntity.name)
    private readonly savedFilterRepository: Model<SavedFilterDocument>,
  ) {}

  async findAll(userId: string): Promise<SavedFilter[]> {
    const docs = await this.savedFilterRepository.find({ userId }).sort({ createdAt: -1 }).exec();
    return docs.map((doc) => this.toSavedFilter(doc));
  }

  async create(userId: string, name: string, filters: FilterData): Promise<SavedFilter> {
    // Check if user has reached the limit
    const count = await this.savedFilterRepository.countDocuments({ userId });
    if (count >= MAX_SAVED_FILTERS) {
      throw new BadRequestException(`Maximum of ${MAX_SAVED_FILTERS} saved filters allowed`);
    }

    // Check for duplicate name
    const existing = await this.savedFilterRepository.findOne({ userId, name });
    if (existing) {
      throw new BadRequestException(`A filter with name "${name}" already exists`);
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
      throw new NotFoundException('Saved filter not found');
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
