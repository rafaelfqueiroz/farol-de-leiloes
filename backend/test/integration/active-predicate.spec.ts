// SPEC-004 BR-004-16, DL-004-06: "active" is ONE rule with two forms, the pure `isActive` and the
// MongoDB filter `activeAuctionFilter` that search, the sitemap, favorites and the neighborhoods list
// use. This spec holds them equal over a table of stored shapes, at several instants, against a real
// MongoDB under the production setting (sanitizeFilter on, SC-10), and checks the filter's
// operators survive it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { toAuction } from '../../src/auctions/auction.mapper.js';
import { isActive } from '../../src/auctions/domain/active.js';
import { AuctionEntity, AuctionSchema } from '../../src/auctions/schemas/auction.schema.js';
import { activeAuctionFilter } from '../../src/auctions/utils/auction-filters.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { useTestDatabase } from '../support/test-database.js';

const at = (iso: string) => new Date(iso);
const round = (date: string | null) => ({
  label: 'R',
  minimumPrice: null,
  date: date === null ? null : at(date),
});

// One stored shape per row: what the collector, the list or an older release left behind.
const CASES: { name: string; doc: Record<string, unknown> }[] = [
  { name: 'no rounds field (never collected)', doc: { available: true } },
  { name: 'rounds null', doc: { available: true, rounds: null } },
  { name: 'empty rounds', doc: { available: true, rounds: [] } },
  {
    name: 'a round in the future',
    doc: { available: true, rounds: [round('2026-03-16T13:00:00Z')] },
  },
  {
    name: 'a round in the past',
    doc: { available: true, rounds: [round('2026-03-09T13:00:00Z')] },
  },
  {
    name: 'a round exactly at 10h00',
    doc: { available: true, rounds: [round('2026-03-10T13:00:00Z')] },
  },
  {
    name: 'SFI: 1st passed, 2nd ahead',
    doc: {
      available: true,
      rounds: [round('2026-03-10T13:00:00Z'), round('2026-03-16T13:00:00Z')],
    },
  },
  { name: 'an open-ended round alone', doc: { available: true, rounds: [round(null)] } },
  {
    name: 'an open-ended round after a passed one',
    doc: { available: true, rounds: [round('2020-01-01T00:00:00Z'), round(null)] },
  },
  { name: 'unavailable, open-ended', doc: { available: false, rounds: [round(null)] } },
  { name: 'unavailable, never collected', doc: { available: false } },
  {
    name: 'unavailable, future round',
    doc: { available: false, rounds: [round('2099-01-01T00:00:00Z')] },
  },
];

// Around the SFI acceptance case: before 10h00, at 10h00, after the 2nd round, long after.
const INSTANTS = [
  '2026-03-10T12:59:59.999Z',
  '2026-03-10T13:00:00.000Z',
  '2026-03-16T12:59:59.999Z',
  '2026-03-16T13:00:00.000Z',
  '2030-01-01T00:00:00.000Z',
];

describe('the active predicate: in memory and in MongoDB (integration)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let auctions: Model<AuctionEntity>;

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([{ name: AuctionEntity.name, schema: AuctionSchema }]),
      ],
    }).compile();
    auctions = moduleRef.get(getModelToken(AuctionEntity.name));
    await auctions.collection.insertMany(
      CASES.map(({ name, doc }) => ({ code: name, updatedAt: at('2026-01-01T00:00:00Z'), ...doc })),
    );
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  const inMemory = async (now: Date) => {
    const docs = await auctions.find({}).lean();
    return docs
      .filter((doc) => {
        const auction = toAuction(doc);
        return isActive({ available: auction.available, rounds: auction.rounds }, now);
      })
      .map((doc) => doc.code)
      .sort();
  };
  const inMongo = async (now: Date) =>
    (await auctions.find(activeAuctionFilter(now)).select('code').lean())
      .map((doc) => doc.code)
      .sort();

  it.each(INSTANTS)('agree on every stored shape at %s', async (iso) => {
    const now = at(iso);

    expect(await inMongo(now)).toEqual(await inMemory(now));
  });

  it('say what the rules say, by hand, at 10h00 Brasília on day D (13:00Z)', async () => {
    const now = at('2026-03-10T13:00:00.000Z');

    expect(await inMongo(now)).toEqual(
      [
        'no rounds field (never collected)',
        'rounds null',
        'empty rounds',
        'a round in the future',
        'SFI: 1st passed, 2nd ahead',
        'an open-ended round alone',
        'an open-ended round after a passed one',
      ].sort(),
    );
  });

  it('say that nothing but open-ended and never-collected is active long after every date', async () => {
    expect(await inMongo(at('2030-01-01T00:00:00.000Z'))).toEqual(
      [
        'no rounds field (never collected)',
        'rounds null',
        'empty rounds',
        'an open-ended round alone',
        'an open-ended round after a passed one',
      ].sort(),
    );
  });
});
