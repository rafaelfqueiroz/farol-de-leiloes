import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Model } from 'mongoose';
import { AuctionEntity, AuctionDocument, Address, Phase } from './schemas/auction.schema';
import { Auction, AuctionListResult } from './interfaces/auction.interface';
import schedulerConfig, { SchedulerConfig } from '../config/scheduler.config';

export interface AuctionUpsert {
  code?: string;
  title?: string;
  address?: Address;
  appraisalPrice?: number;
  phases?: Phase[];
  detailsUrl?: string;
}

export interface QueryFilters {
  state?: string;
  city?: string | string[];
  neighborhood?: string | string[];
  modality?: string | string[];
  minMargin?: number;
  maxMargin?: number;
  take?: number;
  skip?: number;
}

const NEIGHBORHOODS_CACHE_PREFIX = 'neighborhoods';

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(AuctionsService.name);
  private readonly cacheEnabled: boolean;

  constructor(
    @InjectModel(AuctionEntity.name) private readonly auctionRepository: Model<AuctionDocument>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
  ) {
    const config = this.configService.get<SchedulerConfig>(schedulerConfig.KEY);
    this.cacheEnabled = config?.cache.neighborhoodsEnabled ?? false;
  }

  async upsertMany(items: AuctionUpsert[]) {
    this.logger.log(`[upsertMany] Received ${items.length} items`);
    if (!items.length) return { matched: 0, upserted: 0, modified: 0 };

    // Step 1: Fetch all existing auctions in ONE query
    const codes = items.map((item) => item.code).filter(Boolean) as string[];
    this.logger.log(`[upsertMany] Valid codes: ${codes.length}`);

    const existing = await this.auctionRepository.find({ code: { $in: codes } }).select('code phases').lean();
    this.logger.log(`[upsertMany] Found ${existing.length} existing auctions in DB`);

    const existingMap = new Map(existing.map((doc) => [doc.code, doc]));

    // Step 2: Build bulk operations
    const ops: any[] = [];
    let skippedNoCode = 0;
    let skippedNoPhases = 0;
    let skippedSameModality = 0;
    let insertOps = 0;
    let updateOps = 0;

    for (const item of items) {
      // Code is always present (from CSV or extracted from URL)
      if (!item.code) {
        skippedNoCode++;
        continue;
      }

      const code = item.code;
      const newPhases = item.phases ?? [];

      // Skip if no phases provided
      if (newPhases.length === 0) {
        skippedNoPhases++;
        continue;
      }

      const newPhase = newPhases[0]; // CSV imports have single phase
      const existingDoc = existingMap.get(code);

      if (!existingDoc) {
        // INSERT: New auction
        insertOps++;
        ops.push({
          insertOne: {
            document: {
              code,
              title: item.title ?? null,
              address: item.address ?? {},
              appraisalPrice: item.appraisalPrice ?? null,
              phases: newPhases,
              currentPhase: newPhase,
              detailsUrl: item.detailsUrl ?? null,
              createdAt: new Date(),
              updatedAt: new Date(),
            },
          },
        });
      } else {
        // UPDATE: Existing auction
        const existingPhases = existingDoc.phases ?? [];
        const lastPhase = existingPhases[existingPhases.length - 1];

        // Only add phase if modality is different
        if (lastPhase?.modality !== newPhase.modality) {
          updateOps++;
          const updatedPhases = [...existingPhases, ...newPhases];
          ops.push({
            updateOne: {
              filter: { code },
              update: {
                $set: {
                  phases: updatedPhases,
                  currentPhase: newPhase,
                  updatedAt: new Date(),
                },
              },
            },
          });
        } else {
          skippedSameModality++;
        }
      }
    }

    this.logger.log(`[upsertMany] Skipped - no code: ${skippedNoCode}, no phases: ${skippedNoPhases}, same modality: ${skippedSameModality}`);
    this.logger.log(`[upsertMany] Operations - inserts: ${insertOps}, updates: ${updateOps}, total: ${ops.length}`);

    if (ops.length === 0) {
      this.logger.log(`[upsertMany] No operations to execute`);
      return { matched: 0, upserted: 0, modified: 0 };
    }

    const res = await this.auctionRepository.bulkWrite(ops, { ordered: false });
    this.logger.log(`[upsertMany] BulkWrite result - matched: ${res.matchedCount}, upserted: ${res.upsertedCount}, modified: ${res.modifiedCount}`);
    return {
      matched: res.matchedCount,
      upserted: res.upsertedCount,
      modified: res.modifiedCount,
    };
  }

  async query(filters: QueryFilters): Promise<AuctionListResult> {
    const take = Math.min(filters.take ?? 50, 200);
    const skip = filters.skip ?? 0;

    // Build query using currentPhase denormalized field
    // Filter active auctions: available AND (ONLINE_SALES OR has future date)
    const query: Record<string, unknown> = this.buildActiveAuctionFilter();

    if (filters.state) query['address.state'] = filters.state.toUpperCase();

    // Handle city filter (single value or array)
    if (filters.city) {
      const cities = Array.isArray(filters.city) ? filters.city : [filters.city];
      if (cities.length === 1) {
        query['address.city'] = new RegExp(`^${escapeRegExp(cities[0])}`, 'i');
      } else {
        query['address.city'] = {
          $in: cities.map(c => new RegExp(`^${escapeRegExp(c)}`, 'i')),
        };
      }
    }

    // Handle neighborhood filter (single value or array)
    if (filters.neighborhood) {
      const neighborhoods = Array.isArray(filters.neighborhood) ? filters.neighborhood : [filters.neighborhood];
      if (neighborhoods.length === 1) {
        query['address.neighborhood'] = new RegExp(`^${escapeRegExp(neighborhoods[0])}`, 'i');
      } else {
        query['address.neighborhood'] = {
          $in: neighborhoods.map(n => new RegExp(`^${escapeRegExp(n)}`, 'i')),
        };
      }
    }

    // Filter by modality on currentPhase (single value or array)
    if (filters.modality) {
      const modalities = Array.isArray(filters.modality) ? filters.modality : [filters.modality];
      if (modalities.length === 1) {
        query['currentPhase.modality'] = modalities[0];
      } else {
        query['currentPhase.modality'] = { $in: modalities };
      }
    }

    // Filter by price range on currentPhase.minimumPrice
    if (filters.minMargin !== undefined || filters.maxMargin !== undefined) {
      const priceMatch: Record<string, unknown> = {};
      if (filters.minMargin !== undefined) {
        priceMatch.$gte = filters.minMargin;
      }
      if (filters.maxMargin !== undefined) {
        priceMatch.$lte = filters.maxMargin;
      }
      query['currentPhase.minimumPrice'] = priceMatch;
    }

    this.logger.debug(`Query filters: ${JSON.stringify(filters)}, Query: ${JSON.stringify(query)}`);

    // Get total count
    const total = await this.auctionRepository.countDocuments(query).exec();

    // Get documents with sort, skip, limit
    const docs = await this.auctionRepository
      .find(query)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(take)
      .lean()
      .exec();

    this.logger.log(`[query] Found ${docs.length} docs, total: ${total}`);
    return { total, items: docs.map(doc => this.toAuction(doc)) };
  }

  async findByCode(code: string): Promise<Auction | null> {
    const doc = await this.auctionRepository.findOne({ code, available: true }).exec();
    return doc ? this.toAuction(doc) : null;
  }

  async findDocumentByCode(code: string): Promise<AuctionDocument | null> {
    return this.auctionRepository.findOne({ code }).exec();
  }

  /**
   * Get all auction codes for sitemap generation
   * Returns codes of active auctions sorted by updatedAt
   */
  async getAllCodes(): Promise<{ code: string; updatedAt: Date }[]> {
    const docs = await this.auctionRepository
      .find(this.buildActiveAuctionFilter())
      .select('code updatedAt')
      .sort({ updatedAt: -1 })
      .lean()
      .exec();

    return docs.map(doc => ({
      code: doc.code,
      updatedAt: doc.updatedAt,
    }));
  }

  private toAuction(doc: any): Auction {
    const phases = doc.phases ?? [];

    // Compute URLs from file objects (prefer publicUrl, fallback to originalUrl)
    const imageUrl = doc.image?.publicUrl ?? doc.image?.originalUrl ?? null;
    const matriculaUrl = doc.matricula?.publicUrl ?? doc.matricula?.originalUrl ?? null;
    // TODO: editalUrl disabled - edital is tied to auction phase, not the auction itself
    // const editalUrl = doc.edital?.publicUrl ?? doc.edital?.originalUrl ?? null;

    return {
      code: doc.code,
      title: doc.title ?? null,
      address: doc.address ?? null,
      appraisalPrice: doc.appraisalPrice ?? null,
      phases,
      currentPhase: doc.currentPhase ?? phases[phases.length - 1] ?? null,
      detailsUrl: doc.detailsUrl ?? null,
      imageUrl,
      matriculaUrl,
      editalUrl: null, // Disabled - edital is tied to auction phase
      description: doc.description ?? null,
      fulfilled: doc.fulfilled ?? false,
      available: doc.available ?? true,
      updatedAt: doc.updatedAt,
    };
  }

  /**
   * Builds the MongoDB query filter for active auctions.
   * An auction is active if available is true.
   */
  private buildActiveAuctionFilter(): Record<string, unknown> {
    return {
      available: true,
    };
  }

  /**
   * Get distinct neighborhoods for a given state and cities
   * Results are cached for performance
   */
  async getNeighborhoods(state: string, cities: string[]): Promise<string[]> {
    // Build cache key
    const sortedCities = [...cities].sort();
    const cacheKey = `${NEIGHBORHOODS_CACHE_PREFIX}:${state.toUpperCase()}:${sortedCities.join(',')}`;

    // Check cache first (if enabled)
    if (this.cacheEnabled) {
      const cached = await this.cacheManager.get<string[]>(cacheKey);
      if (cached) {
        this.logger.debug(`[getNeighborhoods] Cache hit for ${cacheKey}`);
        return cached;
      }
      this.logger.debug(`[getNeighborhoods] Cache miss for ${cacheKey}, querying database`);
    } else {
      this.logger.debug(`[getNeighborhoods] Cache disabled, querying database for ${cacheKey}`);
    }

    // Build match stage, excluding inactive auctions
    const matchStage: Record<string, unknown> = {
      ...this.buildActiveAuctionFilter(),
      'address.state': state.toUpperCase(),
      'address.neighborhood': { $exists: true, $nin: [null, ''] },
    };

    // Match cities with case-insensitive regex
    if (cities.length === 1) {
      matchStage['address.city'] = new RegExp(`^${escapeRegExp(cities[0])}`, 'i');
    } else {
      matchStage['address.city'] = {
        $in: cities.map(c => new RegExp(`^${escapeRegExp(c)}`, 'i')),
      };
    }

    this.logger.debug(`[getNeighborhoods] Filter: ${JSON.stringify(matchStage)}`);

    // Aggregate to get distinct neighborhoods
    const result = await this.auctionRepository.aggregate([
      { $match: matchStage },
      { $group: { _id: '$address.neighborhood' } },
      { $sort: { _id: 1 } },
    ]).exec();

    const neighborhoods = result
      .map(doc => doc._id as string)
      .filter(Boolean);

    // Cache the result (if enabled)
    if (this.cacheEnabled) {
      await this.cacheManager.set(cacheKey, neighborhoods);
      this.logger.debug(`[getNeighborhoods] Cached ${neighborhoods.length} neighborhoods for ${cacheKey}`);
    }

    return neighborhoods;
  }

  /**
   * Invalidate all neighborhoods cache entries
   * Called after import to ensure fresh data
   */
  async invalidateNeighborhoodsCache(): Promise<void> {
    this.logger.log('[invalidateNeighborhoodsCache] Clearing neighborhoods cache');
    // cache-manager uses stores array, access first store and call reset
    const stores = (this.cacheManager as any).stores;
    if (stores && stores[0] && typeof stores[0].reset === 'function') {
      await stores[0].reset();
    }
    this.logger.log('[invalidateNeighborhoodsCache] Cache cleared');
  }

}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

