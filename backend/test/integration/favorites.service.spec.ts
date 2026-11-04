// Integration: FavoritesService against a real MongoDB (Testcontainers, TESTING §2). Proves the
// paginated favorites list (AR-35) and the codes lookup against stored documents: owner-scoped
// (AR-12; the HTTP-level isolation gate arrives with #2, TESTING §4), most recent first, counting
// only active auctions, with page boundaries that neither repeat nor skip.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Model, Types } from 'mongoose';
import { AuctionsService } from '../../src/auctions/auctions.service';
import {
  AuctionEntity,
  AuctionSchema,
  PhaseModality,
} from '../../src/auctions/schemas/auction.schema';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety';
import { Clock } from '../../src/common/clock/clock';
import { FakeClock } from '../fakes/fake-clock';
import { FavoritesService } from '../../src/favorites/favorites.service';
import { FavoriteEntity, FavoriteSchema } from '../../src/favorites/schemas/favorite.schema';
import { useTestDatabase } from '../support/test-database';
import { testConfigService } from '../support/test-env';

const USER_A = new Types.ObjectId('64b7f0000000000000000a01');
const USER_B = new Types.ObjectId('64b7f0000000000000000b01');

// Far from any day the suite runs, so activity does not depend on the clock (TS-06).
const LONG_AGO = new Date('2000-01-01T00:00:00.000Z');
const UPDATED = new Date('2026-01-15T12:00:00.000Z');

function auction(code: string, overrides: Record<string, unknown> = {}) {
  const phase = {
    modality: PhaseModality.ONLINE_SALES,
    minimumPrice: Types.Decimal128.fromString('100000'), // AR-17
  };
  return {
    code,
    available: true,
    phases: [phase],
    currentPhase: phase,
    updatedAt: UPDATED,
    ...overrides,
  };
}

describe('FavoritesService (integration)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let service: FavoritesService;

  beforeAll(async () => {
    // As in production (SC-10): the $in lookups must work with sanitizeFilter on.
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([
          { name: FavoriteEntity.name, schema: FavoriteSchema },
          { name: AuctionEntity.name, schema: AuctionSchema },
        ]),
      ],
      providers: [
        FavoritesService,
        AuctionsService,
        { provide: Clock, useValue: new FakeClock() },
        { provide: CACHE_MANAGER, useValue: {} },
        { provide: ConfigService, useValue: testConfigService() },
      ],
    }).compile();
    service = moduleRef.get(FavoritesService);

    const auctions = moduleRef.get<Model<AuctionEntity>>(getModelToken(AuctionEntity.name));
    const closed = { modality: PhaseModality.SFI_AUCTION, phaseDates: [LONG_AGO] };
    const inserted = await auctions.collection.insertMany([
      auction('A1'),
      auction('A2'),
      auction('A3-closed', { phases: [closed], currentPhase: closed }),
      auction('A4-unavailable', { available: false }),
      auction('B1'),
    ]);
    const idOf = (index: number) => inserted.insertedIds[index];

    // createdAt increases down the list: the last favorite of each user is their newest.
    const favorites = moduleRef.get<Model<FavoriteEntity>>(getModelToken(FavoriteEntity.name));
    const favorite = (
      userId: Types.ObjectId,
      auctionCode: string,
      index: number,
      minute: number,
    ) => ({
      userId,
      auctionCode,
      auction: idOf(index),
      createdAt: new Date(Date.UTC(2026, 0, 15, 12, minute)),
      updatedAt: new Date(Date.UTC(2026, 0, 15, 12, minute)),
    });
    await favorites.collection.insertMany([
      favorite(USER_A, 'A1', 0, 1),
      favorite(USER_B, 'B1', 4, 2),
      favorite(USER_A, 'A2', 1, 3),
      favorite(USER_A, 'A3-closed', 2, 4),
      favorite(USER_B, 'A1', 0, 5),
      favorite(USER_A, 'A4-unavailable', 3, 6),
    ]);
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('findPage', () => {
    it("pages the user's active favorites, most recently favorited first", async () => {
      const page = await service.findPage(USER_A.toString(), { page: 1, pageSize: 20 });

      // A's favorites, newest first: A4 (unavailable), A3 (closed), A2, A1 -> active: A2, A1.
      expect(page).toMatchObject({ total: 2, page: 1, pageSize: 20 });
      expect(page.items.map((item) => item.code)).toEqual(['A2', 'A1']);
    });

    it('cuts pages without repeating or skipping, with the total of every page', async () => {
      const first = await service.findPage(USER_A.toString(), { page: 1, pageSize: 1 });
      const second = await service.findPage(USER_A.toString(), { page: 2, pageSize: 1 });
      const third = await service.findPage(USER_A.toString(), { page: 3, pageSize: 1 });

      expect(first.items.map((item) => item.code)).toEqual(['A2']);
      expect(second.items.map((item) => item.code)).toEqual(['A1']);
      expect(third.items).toEqual([]);
      expect([first.total, second.total, third.total]).toEqual([2, 2, 2]);
    });

    it("AR-12: never includes another user's favorites, nor counts them", async () => {
      const page = await service.findPage(USER_B.toString(), { page: 1, pageSize: 20 });

      expect(page.total).toBe(2);
      expect(page.items.map((item) => item.code)).toEqual(['A1', 'B1']);
    });
  });

  describe('findCodes', () => {
    it('lists every code the user favorited, active or not, newest first', async () => {
      await expect(service.findCodes(USER_A.toString())).resolves.toEqual([
        'A4-unavailable',
        'A3-closed',
        'A2',
        'A1',
      ]);
    });

    it("AR-12: holds only the user's own codes", async () => {
      await expect(service.findCodes(USER_B.toString())).resolves.toEqual(['A1', 'B1']);
    });

    it('is empty for a user with no favorites', async () => {
      await expect(service.findCodes(new Types.ObjectId().toString())).resolves.toEqual([]);
    });
  });
});
