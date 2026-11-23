// SPEC-004 BR-004-16, AR-27: how MongoDB runs the one active predicate over a catalogue of a few
// thousand properties. This spec REPORTS the plan; it asserts only what is true today, so a change
// of plan shows up as a deliberate edit here, not a silent regression.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { AuctionEntity, AuctionSchema } from '../../src/auctions/schemas/auction.schema.js';
import { activeAuctionFilter } from '../../src/auctions/utils/auction-filters.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { useTestDatabase } from '../support/test-database.js';

const NOW = new Date('2026-03-10T13:00:00.000Z');
const COUNT = 5000;

/** Every stage name of a plan, outermost first. */
function stages(plan: Record<string, unknown> | undefined): string[] {
  if (!plan) return [];
  const inputs = [plan['inputStage'], ...((plan['inputStages'] as unknown[] | undefined) ?? [])];
  return [
    String(plan['stage']),
    ...inputs.flatMap((input) => stages(input as Record<string, unknown> | undefined)),
  ];
}

describe('the active filter against an index (integration)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let auctions: Model<AuctionEntity>;
  let explained: {
    stages: string[];
    examined: number;
    returned: number;
    millis: number;
  };

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([{ name: AuctionEntity.name, schema: AuctionSchema }]),
      ],
    }).compile();
    auctions = moduleRef.get(getModelToken(AuctionEntity.name));
    await auctions.syncIndexes();
    const shapes = (i: number) => {
      const date = (day: number) => new Date(NOW.getTime() + day * 86_400_000);
      if (i % 10 === 0) return { available: false, rounds: [] };
      if (i % 10 < 4) return { available: true }; // never collected
      if (i % 10 < 6) return { available: true, rounds: [{ label: 'a', date: date(-30) }] }; // closed
      if (i % 10 < 8) return { available: true, rounds: [{ label: 'a', date: date(5) }] };
      return { available: true, rounds: [{ label: 'a', date: null }] }; // open-ended
    };
    await auctions.collection.insertMany(
      Array.from({ length: COUNT }, (_, i) => ({
        code: `E${i}`,
        updatedAt: NOW,
        address: { state: 'SP', city: 'CAMPINAS' },
        ...shapes(i),
      })),
    );
    const plan = (await auctions
      .find(activeAuctionFilter(NOW))
      .explain('executionStats')) as unknown as {
      queryPlanner: { winningPlan: Record<string, unknown> };
      executionStats: {
        totalDocsExamined: number;
        nReturned: number;
        executionTimeMillis: number;
      };
    };
    explained = {
      stages: stages(plan.queryPlanner.winningPlan),
      examined: plan.executionStats.totalDocsExamined,
      returned: plan.executionStats.nReturned,
      millis: plan.executionStats.executionTimeMillis,
    };
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('returns what the predicate says: 30% never collected, 20% ahead, 20% open-ended', () => {
    expect(explained.returned).toBe(COUNT * 0.7);
  });

  it('is index-backed, never a collection scan (AR-27)', () => {
    expect(explained.stages).toContain('IXSCAN');
    expect(explained.stages).not.toContain('COLLSCAN');
  });

  it('REPORT: the index narrows on `available` only; the dates are filtered after the fetch', () => {
    // Measured (MongoDB 8.2, Testcontainers): 5 000 properties, 4 500 available -> 4 500 documents
    // examined for 3 500 returned in ~4 ms; 50 000 properties -> 45 000 examined, ~43 ms. The
    // `$or` of the predicate has a branch ("no round collected yet") no index can answer, so the
    // plan scans the `available: true` range of `{ available, rounds.date }` and filters each
    // document. Cheap at today's catalogue; it grows with the catalogue, not with the answer.
    // A selective plan needs a stored "activeUntil" instant (SPEC-005 / SPEC-003 to decide).
    const available = COUNT * 0.9;
    expect(explained.examined).toBeLessThanOrEqual(available);
  });
});
