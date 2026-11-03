// HTTP contract of the favorites endpoints (TESTING §2): pagination (AR-35), the codes lookup and
// the request DTO (AR-34), with FavoritesService stubbed and the signed-in user faked
// (test/support/http-app.ts). Owner scoping against a real database is in
// test/integration/favorites.service.spec.ts.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FavoritesController } from './favorites.controller';
import { FavoritesService } from './favorites.service';
import { createHttpApp, TEST_USER } from '../../test/support/http-app';
import { itAnswersPages } from '../../test/support/pagination-contract';
import type { Auction } from '../auctions/interfaces/auction.interface';

// The modality as the JSON carries it; the enum lives in the auctions schema (AR-09).
const ONLINE_SALES = 'ONLINE_SALES' as Auction['phases'][number]['modality'];

const AUCTION: Auction = {
  code: '1444400000001',
  title: 'Casa',
  address: { city: 'Natal', state: 'RN' },
  appraisalPrice: 150000,
  phases: [{ modality: ONLINE_SALES, minimumPrice: 90000 }],
  currentPhase: { modality: ONLINE_SALES, minimumPrice: 90000 },
  detailsUrl: null,
  imageUrl: null,
  matriculaUrl: null,
  editalUrl: null,
  description: null,
  fulfilled: true,
  available: true,
  updatedAt: new Date('2026-01-15T12:00:00.000Z'),
};

const AUCTION_JSON = { ...AUCTION, updatedAt: '2026-01-15T12:00:00.000Z' };

describe('FavoritesController over HTTP', () => {
  const favorites = {
    findPage: vi.fn(),
    findCodes: vi.fn(),
    create: vi.fn(),
    remove: vi.fn(),
  };
  let app: INestApplication;

  beforeAll(async () => {
    app = await createHttpApp({
      controllers: [FavoritesController],
      providers: [{ provide: FavoritesService, useValue: favorites }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/favorites', () => {
    itAnswersPages({
      app: () => app,
      path: '/api/favorites',
      method: favorites.findPage,
      pageArg: 1,
      item: AUCTION,
      expectedItem: AUCTION_JSON,
    });

    it("AR-12: pages the signed-in user's favorites only", async () => {
      favorites.findPage.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 20 });

      await request(app.getHttpServer()).get('/api/favorites').expect(200);

      expect(favorites.findPage).toHaveBeenCalledWith(TEST_USER.userId, { page: 1, pageSize: 20 });
    });
  });

  describe('GET /api/favorites/codes', () => {
    it('answers every favorited code of the signed-in user as { codes }', async () => {
      favorites.findCodes.mockResolvedValue(['B', 'A']);

      await request(app.getHttpServer())
        .get('/api/favorites/codes')
        .expect(200, { codes: ['B', 'A'] });

      expect(favorites.findCodes).toHaveBeenCalledWith(TEST_USER.userId);
    });
  });

  describe('POST /api/favorites', () => {
    it('favorites the auction named by code and answers it', async () => {
      favorites.create.mockResolvedValue(AUCTION);

      await request(app.getHttpServer())
        .post('/api/favorites')
        .send({ code: AUCTION.code })
        .expect(201, AUCTION_JSON);

      expect(favorites.create).toHaveBeenCalledWith(TEST_USER.userId, AUCTION.code);
    });

    it('AR-34: refuses a body without a code, or with another owner id', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/favorites')
        .send({ userId: '64b7f0000000000000000002' })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect([...response.body.context.fields].sort()).toEqual(['code', 'userId']);
      expect(favorites.create).not.toHaveBeenCalled();
    });
  });
});
