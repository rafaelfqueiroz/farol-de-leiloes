import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { SavedFilter, FilterData } from './schemas/saved-filter.schema';

const MAX_SAVED_FILTERS = 10;

@Injectable()
export class SavedFiltersService {
  constructor(
    @InjectModel(SavedFilter.name)
    private readonly savedFilterRepository: Model<SavedFilter>,
  ) {}

  async findAll(userId: string): Promise<SavedFilter[]> {
    return this.savedFilterRepository
      .find({ userId })
      .sort({ createdAt: -1 })
      .exec();
  }

  async create(
    userId: string,
    name: string,
    filters: FilterData,
  ): Promise<SavedFilter> {
    // Check if user has reached the limit
    const count = await this.savedFilterRepository.countDocuments({ userId });
    if (count >= MAX_SAVED_FILTERS) {
      throw new BadRequestException(
        `Maximum of ${MAX_SAVED_FILTERS} saved filters allowed`,
      );
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

    return savedFilter.save();
  }

  async delete(userId: string, id: string): Promise<boolean> {
    const result = await this.savedFilterRepository
      .deleteOne({ _id: id, userId })
      .exec();

    if (result.deletedCount === 0) {
      throw new NotFoundException('Saved filter not found');
    }

    return true;
  }
}
