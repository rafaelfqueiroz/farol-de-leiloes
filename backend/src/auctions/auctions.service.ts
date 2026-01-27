import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Auction, AuctionDocument, Address, Phase } from './schemas/auction.schema';

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
  neighborhood?: string;
  modality?: string | string[];
  minMargin?: number;
  maxMargin?: number;
  take?: number;
  skip?: number;
}

@Injectable()
export class AuctionsService {
  constructor(
    @InjectModel(Auction.name) private readonly auctionRepository: Model<AuctionDocument>,
  ) {}

  async upsertMany(items: AuctionUpsert[]) {
    console.log(`[upsertMany] Received ${items.length} items`);
    if (!items.length) return { matched: 0, upserted: 0, modified: 0 };

    // Step 1: Fetch all existing auctions in ONE query
    const codes = items.map((item) => item.code).filter(Boolean) as string[];
    console.log(`[upsertMany] Valid codes: ${codes.length}`);

    const existing = await this.auctionRepository.find({ code: { $in: codes } }).select('code phases').lean();
    console.log(`[upsertMany] Found ${existing.length} existing auctions in DB`);

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
          ops.push({
            updateOne: {
              filter: { code },
              update: {
                $set: {
                  phases: [...existingPhases, ...newPhases],
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

    console.log(`[upsertMany] Skipped - no code: ${skippedNoCode}, no phases: ${skippedNoPhases}, same modality: ${skippedSameModality}`);
    console.log(`[upsertMany] Operations - inserts: ${insertOps}, updates: ${updateOps}, total: ${ops.length}`);

    if (ops.length === 0) {
      console.log(`[upsertMany] No operations to execute`);
      return { matched: 0, upserted: 0, modified: 0 };
    }

    const res = await this.auctionRepository.bulkWrite(ops, { ordered: false });
    console.log(`[upsertMany] BulkWrite result - matched: ${res.matchedCount}, upserted: ${res.upsertedCount}, modified: ${res.modifiedCount}`);
    return {
      matched: res.matchedCount,
      upserted: res.upsertedCount,
      modified: res.modifiedCount,
    };
  }

  async query(filters: QueryFilters) {
    const take = Math.min(filters.take ?? 50, 200);
    const skip = filters.skip ?? 0;

    // Build aggregation pipeline to filter by last phase modality/price
    const pipeline: any[] = [];

    // Match by address filters first
    const matchStage: Record<string, unknown> = {};
    if (filters.state) matchStage['address.state'] = filters.state.toUpperCase();

    // Handle city filter (single value or array)
    if (filters.city) {
      const cities = Array.isArray(filters.city) ? filters.city : [filters.city];
      if (cities.length === 1) {
        matchStage['address.city'] = new RegExp(`^${escapeRegExp(cities[0])}`, 'i');
      } else {
        matchStage['address.city'] = {
          $in: cities.map(c => new RegExp(`^${escapeRegExp(c)}`, 'i')),
        };
      }
    }

    if (filters.neighborhood) matchStage['address.neighborhood'] = new RegExp(`^${escapeRegExp(filters.neighborhood)}`, 'i');

    if (Object.keys(matchStage).length > 0) {
      pipeline.push({ $match: matchStage });
    }

    // Add computed field for last phase
    pipeline.push({
      $addFields: {
        lastPhase: { $arrayElemAt: ['$phases', -1] },
      },
    });

    // Filter by modality on last phase (single value or array)
    if (filters.modality) {
      const modalities = Array.isArray(filters.modality) ? filters.modality : [filters.modality];
      if (modalities.length === 1) {
        pipeline.push({
          $match: { 'lastPhase.modality': modalities[0] },
        });
      } else {
        pipeline.push({
          $match: { 'lastPhase.modality': { $in: modalities } },
        });
      }
    }

    // Filter by price range on last phase's minimumPrice
    if (filters.minMargin !== undefined || filters.maxMargin !== undefined) {
      const priceMatch: Record<string, unknown> = {};
      if (filters.minMargin !== undefined) {
        priceMatch.$gte = filters.minMargin;
      }
      if (filters.maxMargin !== undefined) {
        priceMatch.$lte = filters.maxMargin;
      }
      pipeline.push({
        $match: { 'lastPhase.minimumPrice': priceMatch },
      });
    }

    // Remove the computed field
    pipeline.push({
      $unset: 'lastPhase',
    });

    console.log('Query filters:', filters, 'Aggregation pipeline:', JSON.stringify(pipeline));

    // Get total count with same filters (without skip/limit)
    const countPipeline = [...pipeline, { $count: 'total' }];
    const countResult = await this.auctionRepository.aggregate(countPipeline).exec();
    const total = countResult[0]?.total ?? 0;

    // Add sort, skip, limit
    pipeline.push({ $sort: { updatedAt: -1 } });
    pipeline.push({ $skip: skip });
    pipeline.push({ $limit: take });

    const docs = await this.auctionRepository.aggregate(pipeline).exec();
    console.log(`[query] Found ${docs.length} docs, total: ${total}`);
    return { total, items: docs };
  }

  async findByCode(code: string): Promise<AuctionDocument | null> {
    return this.auctionRepository.findOne({ code }).exec();
  }

}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

