import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Model, mongo } from 'mongoose';
import { subHours } from 'date-fns';
import { AuctionEntity, AuctionDocument, Address } from './schemas/auction.schema';
import { Auction, AuctionRecord, Phase } from './interfaces/auction.interface';
import { toAuction, toStoredPhase } from './auction.mapper';
import { isAuctionActive } from './utils/auction-filters';
import { fetchAndCheckAvailability } from './scraper/details-scraper';
import schedulerConfig, { SchedulerConfig } from '../config/scheduler.config';
import { errorMessage } from '../common/error-message';
import { DomainError } from '../common/errors/domain-error';
import { decimalFilter, serverOperators } from '../common/mongo/query-safety';
import { Clock } from '../common/clock/clock';
import type { Decimal } from '../common/money/money';
import { toDecimal128OrNull } from '../common/money/decimal128';
import {
  type PageRequest,
  type Paginated,
  paginated,
  skipOf,
} from '../common/pagination/paginated';

export interface AuctionUpsert {
  code?: string;
  title?: string;
  address?: Address;
  /** Reais (AR-17). */
  appraisalPrice?: Decimal;
  phases?: Phase[];
  detailsUrl?: string;
}

export interface QueryFilters {
  state?: string;
  city?: string | string[];
  neighborhood?: string | string[];
  modality?: string | string[];
  /** Bounds of the current phase's minimum price, in reais (AR-17). */
  minPrice?: Decimal;
  maxPrice?: Decimal;
}

const NEIGHBORHOODS_CACHE_PREFIX = 'neighborhoods';

// The fields upsertMany writes. Partial because the schema defaults fill `fulfilled` and
// `available` on insert; createdAt is set by hand alongside the schema's own timestamp.
type AuctionWrite = Partial<AuctionEntity> & { createdAt?: Date };

@Injectable()
export class AuctionsService {
  private readonly logger = new Logger(AuctionsService.name);
  private readonly cacheEnabled: boolean;

  constructor(
    @InjectModel(AuctionEntity.name) private readonly auctionRepository: Model<AuctionDocument>,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly configService: ConfigService,
    private readonly clock: Clock, // AR-24
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

    const existing = await this.auctionRepository
      .find({ code: serverOperators({ $in: codes }) })
      .select('code phases')
      .lean();
    this.logger.log(`[upsertMany] Found ${existing.length} existing auctions in DB`);

    const existingMap = new Map(existing.map((doc) => [doc.code, doc]));
    // AR-24: one instant for the whole import, from the injected clock.
    const now = this.clock.now();

    // Step 2: Build bulk operations
    const ops: mongo.AnyBulkWriteOperation<AuctionWrite>[] = [];
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

      const [newPhase] = newPhases; // CSV imports have single phase
      // Unreachable: the empty case was skipped above. Narrows the type (DV-03).
      if (!newPhase) continue;
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
              // AR-17: every price is written as Decimal128.
              appraisalPrice: toDecimal128OrNull(item.appraisalPrice),
              phases: newPhases.map(toStoredPhase),
              currentPhase: toStoredPhase(newPhase),
              detailsUrl: item.detailsUrl ?? null,
              createdAt: now,
              updatedAt: now,
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
          // The phases already stored are written back as read: Decimal128 already (AR-17).
          const updatedPhases = [...existingPhases, ...newPhases.map(toStoredPhase)];
          ops.push({
            updateOne: {
              filter: { code },
              update: {
                $set: {
                  phases: updatedPhases,
                  currentPhase: toStoredPhase(newPhase),
                  updatedAt: now,
                },
              },
            },
          });
        } else {
          skippedSameModality++;
        }
      }
    }

    this.logger.log(
      `[upsertMany] Skipped - no code: ${skippedNoCode}, no phases: ${skippedNoPhases}, same modality: ${skippedSameModality}`,
    );
    this.logger.log(
      `[upsertMany] Operations - inserts: ${insertOps}, updates: ${updateOps}, total: ${ops.length}`,
    );

    if (ops.length === 0) {
      this.logger.log(`[upsertMany] No operations to execute`);
      return { matched: 0, upserted: 0, modified: 0 };
    }

    const res = await this.auctionRepository.bulkWrite(ops, { ordered: false });
    this.logger.log(
      `[upsertMany] BulkWrite result - matched: ${res.matchedCount}, upserted: ${res.upsertedCount}, modified: ${res.modifiedCount}`,
    );
    return {
      matched: res.matchedCount,
      upserted: res.upsertedCount,
      modified: res.modifiedCount,
    };
  }

  /**
   * Mark auctions present in the imported CSV as available.
   * Restores auctions previously marked unavailable that reappear in the CSV.
   */
  async markAvailable(codes: string[]): Promise<number> {
    if (!codes.length) return 0;
    const result = await this.auctionRepository.updateMany(
      { code: serverOperators({ $in: codes }), available: serverOperators({ $ne: true }) },
      { $set: { available: true, updatedAt: this.clock.now() } },
    );
    return result.modifiedCount;
  }

  /** AR-35: one page of the matching active auctions, newest update first. */
  async query(filters: QueryFilters, page: PageRequest): Promise<Paginated<Auction>> {
    // Build query using currentPhase denormalized field
    // Filter active auctions: available AND (ONLINE_SALES OR has future date)
    const query: Record<string, unknown> = this.buildActiveAuctionFilter();

    // SC-10: the DTO validates the filters (AR-34), and this builder does not rely on it. Every
    // value is checked to be a string or a finite Decimal before it reaches the query, so a request
    // can never put an operator ({ $ne: null }, { $regex: '.*' }) where a scalar belongs. The
    // `$in` and range operators below are written here, so they are marked server-built.
    if (filters.state) {
      query['address.state'] = { $eq: stringFilter(filters.state, 'state').toUpperCase() };
    }

    // Handle city filter (single value or array)
    if (filters.city) {
      query['address.city'] = prefixFilter(filters.city, 'city');
    }

    // Handle neighborhood filter (single value or array)
    if (filters.neighborhood) {
      query['address.neighborhood'] = prefixFilter(filters.neighborhood, 'neighborhood');
    }

    // Filter by modality on currentPhase (single value or array)
    if (filters.modality) {
      const modalities = stringFilters(filters.modality, 'modality');
      query['currentPhase.modality'] =
        modalities.length === 1 ? { $eq: modalities[0] } : serverOperators({ $in: modalities });
    }

    // minPrice/maxPrice are the query names for the bounds of currentPhase.minimumPrice (#81).
    // Filter by price range on currentPhase.minimumPrice, compared as Decimal128 (AR-17).
    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const priceMatch: Record<string, unknown> = {};
      if (filters.minPrice !== undefined) {
        priceMatch.$gte = decimalFilter(filters.minPrice, 'minPrice');
      }
      if (filters.maxPrice !== undefined) {
        priceMatch.$lte = decimalFilter(filters.maxPrice, 'maxPrice');
      }
      query['currentPhase.minimumPrice'] = serverOperators(priceMatch);
    }

    this.logger.debug(`Query filters: ${JSON.stringify(filters)}, Query: ${JSON.stringify(query)}`);

    // Get total count
    const total = await this.auctionRepository.countDocuments(query).exec();

    // AR-35: `_id` breaks updatedAt ties (a CSV import stamps many auctions with the same
    // instant), so a page boundary never repeats or skips an auction.
    const docs = await this.auctionRepository
      .find(query)
      .sort({ updatedAt: -1, _id: -1 })
      .skip(skipOf(page))
      .limit(page.pageSize)
      .lean()
      .exec();

    this.logger.log(`[query] Found ${docs.length} docs, total: ${total}`);
    return paginated(
      docs.map((doc) => toAuction(doc)),
      total,
      page,
    );
  }

  async findByCode(code: string): Promise<Auction | null> {
    // SC-10: a code is a string; an object (`{ $ne: null }`) is not an auction, it is not found.
    if (typeof code !== 'string') return null;
    const doc = await this.auctionRepository
      .findOne({ code: { $eq: code }, available: true })
      .exec();
    return doc ? toAuction(doc) : null;
  }

  /** The available auctions among `codes`, in no particular order. */
  async findAvailableByCodes(codes: string[]): Promise<Auction[]> {
    if (!codes.length) return [];
    const docs = await this.auctionRepository
      .find({ code: serverOperators({ $in: codes }), available: true })
      .lean()
      .exec();
    return docs.map((doc) => toAuction(doc));
  }

  /**
   * The codes among `codes` whose auction is active (isAuctionActive). Reads only the fields the
   * check needs, so a caller can count and page a large set before loading whole auctions.
   */
  async findActiveCodes(codes: string[]): Promise<Set<string>> {
    if (!codes.length) return new Set();
    const docs = await this.auctionRepository
      .find({ code: serverOperators({ $in: codes }), available: true })
      .select('code phases currentPhase available updatedAt')
      .lean()
      .exec();
    const now = this.clock.now(); // AR-24
    return new Set(
      docs
        .map((doc) => toAuction(doc))
        .filter((auction) => isAuctionActive(auction, now))
        .map((auction) => auction.code),
    );
  }

  async findDocumentByCode(code: string): Promise<AuctionDocument | null> {
    // SC-10: as findByCode, a non-string code finds nothing.
    if (typeof code !== 'string') return null;
    return this.auctionRepository.findOne({ code: { $eq: code } }).exec();
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

    return docs.map((doc) => ({
      code: doc.code,
      updatedAt: doc.updatedAt,
    }));
  }

  /**
   * The `Auction` of a stored record — for modules that hold one populated into their own
   * documents (favorites), so they map it the same way without the auction schema (AR-09).
   */
  toAuction(record: AuctionRecord): Auction {
    return toAuction(record);
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
      matchStage['address.city'] = new RegExp(`^${escapeRegExp(cities[0] ?? '')}`, 'i');
    } else {
      matchStage['address.city'] = {
        $in: cities.map((c) => new RegExp(`^${escapeRegExp(c)}`, 'i')),
      };
    }

    this.logger.debug(`[getNeighborhoods] Filter: ${JSON.stringify(matchStage)}`);

    // Aggregate to get distinct neighborhoods
    const result = await this.auctionRepository
      .aggregate([
        { $match: matchStage },
        { $group: { _id: '$address.neighborhood' } },
        { $sort: { _id: 1 } },
      ])
      .exec();

    const neighborhoods = result.map((doc) => doc._id as string).filter(Boolean);

    // Cache the result (if enabled)
    if (this.cacheEnabled) {
      await this.cacheManager.set(cacheKey, neighborhoods);
      this.logger.debug(
        `[getNeighborhoods] Cached ${neighborhoods.length} neighborhoods for ${cacheKey}`,
      );
    }

    return neighborhoods;
  }

  /**
   * Checks availability of fulfilled auctions whose codes are not in the CSV.
   * Fetches each auction's details page and marks as unavailable if Caixa confirms it.
   */
  async verifyAvailability(
    csvCodes: string[],
  ): Promise<{ checked: number; unavailable: number; errors: number }> {
    const cutoff = subHours(this.clock.now(), 24); // AR-24
    const missingAuctions = await this.auctionRepository
      .find({
        fulfilled: true,
        available: true,
        detailsUrl: serverOperators({ $exists: true, $ne: null }),
        code: serverOperators({ $nin: csvCodes }),
        $or: serverOperators([
          { availabilityCheckedAt: { $exists: false } },
          { availabilityCheckedAt: { $lt: cutoff } },
        ]),
      })
      .select('code detailsUrl')
      .sort({ availabilityCheckedAt: 1 })
      .limit(1000)
      .lean();

    this.logger.log(
      `[verifyAvailability] Found ${missingAuctions.length} auctions not in CSV to check (max 1000)`,
    );

    if (missingAuctions.length === 0) {
      return { checked: 0, unavailable: 0, errors: 0 };
    }

    const batchSize = 15;
    const concurrency = 3;
    const delayBetweenGroups = 1000;
    let unavailableCount = 0;
    let errorCount = 0;

    const totalBatches = Math.ceil(missingAuctions.length / batchSize);

    for (let i = 0; i < missingAuctions.length; i += batchSize) {
      const batch = missingAuctions.slice(i, i + batchSize);
      this.logger.log(
        `[verifyAvailability] Processing batch ${Math.floor(i / batchSize) + 1}/${totalBatches}`,
      );

      for (let j = 0; j < batch.length; j += concurrency) {
        const group = batch.slice(j, j + concurrency);
        const results = await Promise.allSettled(
          group.map(async (auction) => {
            let available: boolean;
            try {
              // The query only selects auctions with a detailsUrl; a missing one fails like a
              // failed fetch (DV-03).
              if (!auction.detailsUrl) throw new Error('auction has no details URL');
              available = await fetchAndCheckAvailability(auction.detailsUrl);
            } catch (error) {
              this.logger.error(
                `[verifyAvailability] Auction ${auction.code} fetch failed for ${auction.detailsUrl}: ${error instanceof Error ? error.message : error}`,
              );
              throw error;
            }
            if (!available) {
              await this.auctionRepository.updateOne(
                { code: auction.code },
                {
                  $set: {
                    available: false,
                    availabilityCheckedAt: this.clock.now(),
                    updatedAt: this.clock.now(),
                  },
                },
              );
              this.logger.debug(
                `[verifyAvailability] Auction ${auction.code} marked as unavailable`,
              );
              return false;
            }
            await this.auctionRepository.updateOne(
              { code: auction.code },
              { $set: { availabilityCheckedAt: this.clock.now() } },
            );
            this.logger.debug(`[verifyAvailability] Auction ${auction.code} still available`);
            return true;
          }),
        );

        for (const [k, result] of results.entries()) {
          if (result.status === 'fulfilled') {
            if (!result.value) unavailableCount++;
          } else {
            errorCount++;
            this.logger.error(
              `[verifyAvailability] Error checking ${group[k]?.code}: ${errorMessage(result.reason)}`,
            );
          }
        }

        await new Promise((resolve) => setTimeout(resolve, delayBetweenGroups));
      }
    }

    return { checked: missingAuctions.length, unavailable: unavailableCount, errors: errorCount };
  }

  /**
   * Invalidate all neighborhoods cache entries
   * Called after import to ensure fresh data
   */
  async invalidateNeighborhoodsCache(): Promise<void> {
    this.logger.log('[invalidateNeighborhoodsCache] Clearing neighborhoods cache');
    // cache-manager uses stores array, access first store and call reset
    const [store] = this.cacheManager.stores;
    if (hasReset(store)) {
      await store.reset();
    }
    this.logger.log('[invalidateNeighborhoodsCache] Cache cleared');
  }
}

function hasReset(store: unknown): store is { reset: () => unknown } {
  return (
    typeof store === 'object' &&
    store !== null &&
    'reset' in store &&
    typeof store.reset === 'function'
  );
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** SC-10: a filter value that must be text. Anything else is a refused request, never a query. */
function stringFilter(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new DomainError('VALIDATION_FAILED', { fields: [field] });
  }
  return value;
}

/** SC-10: one or several texts; every element is checked, so no object slips in through a list. */
function stringFilters(value: unknown, field: string): string[] {
  const values: unknown[] = Array.isArray(value) ? value : [value];
  return values.map((item) => stringFilter(item, field));
}

/**
 * Case-insensitive prefix match on one or several texts. The pattern is escaped, so the text is
 * literal, and a regex is a value, not an operator, to `sanitizeFilter`.
 */
function prefixFilter(value: unknown, field: string): RegExp | Record<string, unknown> {
  const patterns = stringFilters(value, field).map(
    (text) => new RegExp(`^${escapeRegExp(text)}`, 'i'),
  );
  return patterns.length === 1 ? (patterns[0] as RegExp) : serverOperators({ $in: patterns });
}
