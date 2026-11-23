import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { isObjectIdOrHexString, Model } from 'mongoose';
import { AuctionEntity, AuctionDocument } from './schemas/auction.schema.js';
import { Auction, AuctionRecord } from './interfaces/auction.interface.js';
import { toAuction } from './auction.mapper.js';
import { activeAuctionFilter } from './utils/auction-filters.js';
import schedulerConfig, { SchedulerConfig } from '../config/scheduler.config.js';
import { DomainError } from '../common/errors/domain-error.js';
import { decimalFilter, serverOperators } from '../common/mongo/query-safety.js';
import { Clock } from '../common/clock/clock.js';
import type { Decimal } from '../common/money/money.js';
import {
  type PageRequest,
  type Paginated,
  paginated,
  skipOf,
} from '../common/pagination/paginated.js';

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

  /** AR-35: one page of the matching active auctions, newest update first. */
  async query(filters: QueryFilters, page: PageRequest): Promise<Paginated<Auction>> {
    // BR-004-16: active = available and not past its last round, evaluated now (the one predicate).
    const query: Record<string, unknown> = activeAuctionFilter(this.clock.now()); // AR-24

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
      docs.map((doc) => toAuction(doc, this.clock.now())),
      total,
      page,
    );
  }

  async findByCode(code: string): Promise<Auction | null> {
    // SC-10: a code is a string; an object (`{ $ne: null }`) is not an auction, it is not found.
    if (typeof code !== 'string') return null;
    // BR-004-17: a property that left the list or is past its dates is still reachable by its
    // number, with its last known data; `available` and `active` say what it is now.
    const doc = await this.auctionRepository.findOne({ code: { $eq: code } }).exec();
    return doc ? toAuction(doc, this.clock.now()) : null; // AR-24
  }

  /** The auctions among `codes` (BR-004-17: unavailable and inactive ones too), in no particular order. */
  async findByCodes(codes: string[]): Promise<Auction[]> {
    if (!codes.length) return [];
    const docs = await this.auctionRepository
      .find({ code: serverOperators({ $in: codes }) })
      .lean()
      .exec();
    return docs.map((doc) => toAuction(doc, this.clock.now())); // AR-24
  }

  /**
   * The codes among `codes` whose auction is active (BR-004-16): the same predicate search uses
   * (`activeAuctionFilter`), asked of the database, so a caller can count and page a large set
   * before loading whole auctions.
   */
  async findActiveCodes(codes: string[]): Promise<Set<string>> {
    if (!codes.length) return new Set();
    const docs = await this.auctionRepository
      .find({ code: serverOperators({ $in: codes }), ...activeAuctionFilter(this.clock.now()) }) // AR-24
      .select('code')
      .lean()
      .exec();
    return new Set(docs.map((doc) => doc.code));
  }

  async findDocumentByCode(code: string): Promise<AuctionDocument | null> {
    // SC-10: as findByCode, a non-string code finds nothing.
    if (typeof code !== 'string') return null;
    return this.auctionRepository.findOne({ code: { $eq: code } }).exec();
  }

  /** AR-09: reminders resolve legacy document ids through the auctions service boundary. */
  async findDocumentById(id: string): Promise<AuctionDocument | null> {
    // SC-10: reject operator objects and malformed ids before querying; database faults propagate.
    if (typeof id !== 'string' || !isObjectIdOrHexString(id)) return null;
    return this.auctionRepository.findOne({ _id: { $eq: id } }).exec();
  }

  /**
   * Get all auction codes for sitemap generation
   * Returns codes of active auctions sorted by updatedAt
   */
  async getAllCodes(): Promise<{ code: string; updatedAt: Date }[]> {
    const docs = await this.auctionRepository
      .find(activeAuctionFilter(this.clock.now()))
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
    return toAuction(record, this.clock.now()); // AR-24
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
      ...activeAuctionFilter(this.clock.now()),
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
