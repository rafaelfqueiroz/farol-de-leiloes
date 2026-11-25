// Integration: the filters of the scheduled Caixa jobs against a real MongoDB under the production
// setting, sanitizeFilter on (SC-10, #100). A bare operator nested in `$or` is cast as a value and
// throws there, which unit specs with a mocked model cannot show.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongooseModule, getModelToken } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { AuctionEntity, AuctionSchema } from '../../src/auctions/schemas/auction.schema.js';
import {
  missingFromListFilter,
  unfulfilledWithDetailsFilter,
} from '../../src/auctions/utils/job-queries.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { useTestDatabase } from '../support/test-database.js';

const URL_OF = (code: string) => `https://caixa.test/detalhe/${code}`;
const CUTOFF = new Date('2026-01-14T12:00:00.000Z');

describe('scheduled job filters (integration, sanitizeFilter on)', () => {
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
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await auctions.deleteMany({});
  });

  async function seed(code: string, fields: Record<string, unknown>) {
    await auctions.collection.insertOne({ code, detailsUrl: URL_OF(code), ...fields });
  }

  describe('missingFromListFilter', () => {
    it('selects fulfilled, available auctions outside the list never checked or checked before the cutoff', async () => {
      await seed('NEVER', { fulfilled: true, available: true });
      await seed('STALE', {
        fulfilled: true,
        available: true,
        availabilityCheckedAt: new Date('2026-01-13T00:00:00.000Z'),
      });
      await seed('FRESH', {
        fulfilled: true,
        available: true,
        availabilityCheckedAt: new Date('2026-01-15T00:00:00.000Z'),
      });
      await seed('IN-LIST', { fulfilled: true, available: true });
      await seed('NOT-FULFILLED', { fulfilled: false, available: true });
      await seed('UNAVAILABLE', { fulfilled: true, available: false });
      await seed('NO-URL', { fulfilled: true, available: true, detailsUrl: null });

      const found = await auctions.find(missingFromListFilter(['IN-LIST'], CUTOFF)).lean();

      expect(found.map((a) => a.code).sort()).toEqual(['NEVER', 'STALE']);
    });
  });

  describe('unfulfilledWithDetailsFilter', () => {
    it('selects auctions with a details page whose fulfilled flag is false or missing', async () => {
      await seed('MISSING', {});
      await seed('FALSE', { fulfilled: false });
      await seed('TRUE', { fulfilled: true });
      await seed('NO-URL', { fulfilled: false, detailsUrl: null });

      const found = await auctions.find(unfulfilledWithDetailsFilter()).lean();

      expect(found.map((a) => a.code).sort()).toEqual(['FALSE', 'MISSING']);
    });
  });
});
