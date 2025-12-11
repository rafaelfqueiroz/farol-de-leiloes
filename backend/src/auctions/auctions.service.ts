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
  city?: string;
  neighborhood?: string;
  modality?: string;
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
    if (!items.length) return { matched: 0, upserted: 0, modified: 0 };

    // Step 1: Fetch all existing auctions in ONE query
    const codes = items.map((item) => item.code).filter(Boolean) as string[];
    const existing = await this.auctionRepository.find({ code: { $in: codes } }).select('code phases').lean();

    const existingMap = new Map(existing.map((doc) => [doc.code, doc]));

    // Step 2: Build bulk operations
    const ops: any[] = [];

    for (const item of items) {
      // Code is always present (from CSV or extracted from URL)
      if (!item.code) {
        console.warn('Skipping auction without code:', item);
        continue;
      }

      const code = item.code;
      const newPhases = item.phases ?? [];

      // Skip if no phases provided
      if (newPhases.length === 0) {
        continue;
      }

      const newPhase = newPhases[0]; // CSV imports have single phase
      const existingDoc = existingMap.get(code);

      if (!existingDoc) {
        // INSERT: New auction
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
        }
        // If same modality: do nothing (no op added)
      }
    }

    if (ops.length === 0) return { matched: 0, upserted: 0, modified: 0 };

    const res = await this.auctionRepository.bulkWrite(ops, { ordered: false });
    return {
      matched: res.matchedCount,
      upserted: res.upsertedCount,
      modified: res.modifiedCount,
    };
  }

  async query(filters: QueryFilters) {
    const q: Record<string, unknown> = {};
    if (filters.state) q['address.state'] = filters.state.toUpperCase();
    if (filters.city) q['address.city'] = new RegExp(`^${escapeRegExp(filters.city)}`, 'i');
    if (filters.neighborhood) q['address.neighborhood'] = new RegExp(`^${escapeRegExp(filters.neighborhood)}`, 'i');
    // Note: modality filter moved to in-memory filtering to check only the last phase
    const take = Math.min(filters.take ?? 50, 200);
    const skip = filters.skip ?? 0;

    let docs = await this.auctionRepository
      .find(q)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(take)
      .lean();

    // Filter by modality on last phase only
    if (filters.modality) {
      docs = docs.filter((doc) => {
        if (!doc.phases || doc.phases.length === 0) return false;
        const lastPhase = doc.phases[doc.phases.length - 1];
        return lastPhase.modality === filters.modality;
      });
    }

    // Filter by price range on last phase's minimumPrice
    if (filters.minMargin !== undefined || filters.maxMargin !== undefined) {
      docs = docs.filter((doc) => {
        if (!doc.phases || doc.phases.length === 0) return false;
        const lastPhase = doc.phases[doc.phases.length - 1];
        const price = lastPhase.minimumPrice;
        if (price === null || price === undefined) return false;
        if (filters.minMargin !== undefined && price < filters.minMargin) return false;
        if (filters.maxMargin !== undefined && price > filters.maxMargin) return false;
        return true;
      });
    }

    const total = await this.auctionRepository.countDocuments(q);
    return { total, items: docs };
  }

  async findByCode(code: string): Promise<AuctionDocument | null> {
    return this.auctionRepository.findOne({ code }).exec();
  }

}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

