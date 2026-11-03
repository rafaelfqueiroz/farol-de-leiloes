// HTTP-level spec of the list filters' query parsing, through the real Nest + Express stack with
// supertest. Express 5 (Nest 12, #61) replaced the `extended` (qs) query parser with `simple`
// (node:querystring): a repeated key still becomes an array, but bracket syntax no longer nests.
// The query DTOs (auction-query.dto.ts, AR-34) parse lists explicitly (repeated keys or
// comma-separated values), so the app keeps Express 5's default parser; these tests pin that
// contract, and the pagination contract of AR-35.
//
// supertest binds the app to an ephemeral loopback port in this process; nothing leaves the
// machine (TS-01, TS-07). AuctionsService is replaced by a stub: only the arguments the controller
// hands it are under test, and the service has no port yet (TS-03). The app gets main.ts's own
// setup (configureApp): prefix, validation and the error filter.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';
import { configureApp } from '../app.setup';
import { testConfigService } from '../../test/support/test-env';
import { type PageRequest, paginated } from '../common/pagination/paginated';
import { Decimal } from '../common/money/money';
import { PhaseModality } from './schemas/auction.schema';

const LIST_FILTERS = ['city', 'neighborhood', 'modality'] as const;

describe('AuctionsController over HTTP (Express 5 query parsing)', () => {
  const auctions = {
    query: vi.fn(),
    getNeighborhoods: vi.fn(),
    findByCode: vi.fn(),
  };
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuctionsController],
      providers: [
        { provide: AuctionsService, useValue: auctions },
        { provide: ConfigService, useValue: testConfigService() },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    auctions.query.mockImplementation(async (_filters: unknown, page: PageRequest) =>
      paginated([], 0, page),
    );
    auctions.getNeighborhoods.mockResolvedValue([]);
  });

  function lastQueryFilters(): Record<string, unknown> {
    expect(auctions.query).toHaveBeenCalledTimes(1);
    return auctions.query.mock.calls[0]?.[0] as Record<string, unknown>;
  }

  function lastPageRequest(): PageRequest {
    expect(auctions.query).toHaveBeenCalledTimes(1);
    return auctions.query.mock.calls[0]?.[1] as PageRequest;
  }

  describe('GET /api/auctions list filters', () => {
    it.each(LIST_FILTERS)('reads a repeated %s key as a list', async (name) => {
      await request(app.getHttpServer())
        .get(`/api/auctions?${name}=A&${name}=B`)
        .expect(200, { items: [], total: 0, page: 1, pageSize: 20 });

      expect(lastQueryFilters()[name]).toEqual(['A', 'B']);
    });

    it.each(LIST_FILTERS)('splits a comma-separated %s value and trims each item', async (name) => {
      await request(app.getHttpServer()).get(`/api/auctions?${name}=A,%20B`).expect(200);

      expect(lastQueryFilters()[name]).toEqual(['A', 'B']);
    });

    it.each(LIST_FILTERS)('keeps a single %s value as a string', async (name) => {
      await request(app.getHttpServer()).get(`/api/auctions?${name}=A`).expect(200);

      expect(lastQueryFilters()[name]).toBe('A');
    });

    it('decodes percent-encoded values before splitting', async () => {
      // "São Paulo,Santo André" percent-encoded, as URLSearchParams sends it from the frontend.
      await request(app.getHttpServer())
        .get('/api/auctions?city=S%C3%A3o+Paulo%2CSanto+Andr%C3%A9')
        .expect(200);

      expect(lastQueryFilters().city).toEqual(['São Paulo', 'Santo André']);
    });

    it('does not nest bracket keys: the simple parser leaves `city[]` as its own, unknown key', async () => {
      await request(app.getHttpServer())
        .get('/api/auctions?city[]=A&city[]=B')
        .expect(400, { code: 'VALIDATION_FAILED', context: { fields: ['city[]'] } });

      expect(auctions.query).not.toHaveBeenCalled();
    });

    // AR-17: minMargin/maxMargin are prices in reais; a money string reaches the service as a
    // Decimal, never as a float.
    it('turns state and the price bounds into the service filters, prices as Decimal', async () => {
      await request(app.getHttpServer())
        .get('/api/auctions?state=SP&minMargin=10&maxMargin=300000.50')
        .expect(200);

      expect(lastQueryFilters()).toEqual({
        state: 'SP',
        minMargin: new Decimal('10'),
        maxMargin: new Decimal('300000.50'),
      });
    });

    it.each(['lots', '-1', '1e5', '10.505', '1.234,56', '0x10', ''])(
      'refuses minMargin=%s, which is not an amount of reais (MONEY_PATTERN)',
      async (value) => {
        await request(app.getHttpServer())
          .get(`/api/auctions?minMargin=${encodeURIComponent(value)}`)
          .expect(400, { code: 'VALIDATION_FAILED', context: { fields: ['minMargin'] } });

        expect(auctions.query).not.toHaveBeenCalled();
      },
    );

    it('refuses a repeated price bound', async () => {
      await request(app.getHttpServer())
        .get('/api/auctions?maxMargin=1&maxMargin=2')
        .expect(400, { code: 'VALIDATION_FAILED', context: { fields: ['maxMargin'] } });
    });
  });

  describe('GET /api/auctions pagination (AR-35)', () => {
    it('defaults to page 1 of 20', async () => {
      await request(app.getHttpServer())
        .get('/api/auctions')
        .expect(200, { items: [], total: 0, page: 1, pageSize: 20 });

      expect(lastPageRequest()).toEqual({ page: 1, pageSize: 20 });
    });

    it('hands the requested page to the service and echoes it in the envelope', async () => {
      await request(app.getHttpServer())
        .get('/api/auctions?page=3&pageSize=100')
        .expect(200, { items: [], total: 0, page: 3, pageSize: 100 });

      expect(lastPageRequest()).toEqual({ page: 3, pageSize: 100 });
      expect(lastQueryFilters()).not.toHaveProperty('page');
    });

    it('maps the service page to auction DTOs', async () => {
      const auction = {
        code: '1444400000001',
        title: 'Casa',
        address: { city: 'Natal', state: 'RN' },
        appraisalPrice: new Decimal('100000'),
        phases: [{ modality: PhaseModality.SFI_AUCTION, minimumPrice: new Decimal('0.125') }],
        currentPhase: { modality: PhaseModality.SFI_AUCTION, minimumPrice: null },
        detailsUrl: null,
        imageUrl: null,
        matriculaUrl: null,
        editalUrl: null,
        description: null,
        fulfilled: false,
        available: true,
        updatedAt: new Date('2026-01-15T12:00:00.000Z'),
      };
      auctions.query.mockResolvedValue(paginated([auction], 41, { page: 2, pageSize: 20 }));

      const response = await request(app.getHttpServer()).get('/api/auctions?page=2').expect(200);

      expect(response.body).toEqual({
        items: [
          {
            ...auction,
            // AR-17 / AR-19: strings of reais, rounded once at the edge, half-even.
            appraisalPrice: '100000.00',
            phases: [{ modality: 'SFI_AUCTION', minimumPrice: '0.12' }],
            currentPhase: { modality: 'SFI_AUCTION', minimumPrice: null },
            updatedAt: '2026-01-15T12:00:00.000Z',
          },
        ],
        total: 41,
        page: 2,
        pageSize: 20,
      });
    });

    it.each(['101', '0', '-1', '2.5', 'ten'])(
      'refuses pageSize=%s with VALIDATION_FAILED instead of clamping it',
      async (pageSize) => {
        await request(app.getHttpServer())
          .get(`/api/auctions?pageSize=${pageSize}`)
          .expect(400, { code: 'VALIDATION_FAILED', context: { fields: ['pageSize'] } });

        expect(auctions.query).not.toHaveBeenCalled();
      },
    );

    it.each(['0', 'first'])('refuses page=%s', async (page) => {
      await request(app.getHttpServer())
        .get(`/api/auctions?page=${page}`)
        .expect(400, { code: 'VALIDATION_FAILED', context: { fields: ['page'] } });
    });

    it('refuses the retired limit and offset parameters', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/auctions?limit=10&offset=20')
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect([...response.body.context.fields].sort()).toEqual(['limit', 'offset']);
    });
  });

  describe('GET /api/auctions/neighborhoods', () => {
    it('reads repeated city keys as the city list', async () => {
      await request(app.getHttpServer())
        .get('/api/auctions/neighborhoods?state=SP&city=A&city=B')
        .expect(200, { neighborhoods: [] });

      expect(auctions.getNeighborhoods).toHaveBeenCalledWith('SP', ['A', 'B']);
    });

    it('splits comma-separated cities', async () => {
      await request(app.getHttpServer())
        .get('/api/auctions/neighborhoods?state=SP&city=A,%20B')
        .expect(200);

      expect(auctions.getNeighborhoods).toHaveBeenCalledWith('SP', ['A', 'B']);
    });

    it('wraps a single city in a list', async () => {
      await request(app.getHttpServer())
        .get('/api/auctions/neighborhoods?state=SP&city=A')
        .expect(200);

      expect(auctions.getNeighborhoods).toHaveBeenCalledWith('SP', ['A']);
    });

    it('answers VALIDATION_FAILED naming the missing city', async () => {
      await request(app.getHttpServer())
        .get('/api/auctions/neighborhoods?state=SP')
        .expect(400, { code: 'VALIDATION_FAILED', context: { fields: ['city'] } });

      expect(auctions.getNeighborhoods).not.toHaveBeenCalled();
    });

    it('names both state and city when neither is given', async () => {
      await request(app.getHttpServer())
        .get('/api/auctions/neighborhoods')
        .expect(400, { code: 'VALIDATION_FAILED', context: { fields: ['state', 'city'] } });
    });
  });

  describe('GET /api/auctions/:code', () => {
    it('answers AUCTION_NOT_FOUND for an unknown or unavailable auction', async () => {
      auctions.findByCode.mockResolvedValue(null);

      await request(app.getHttpServer())
        .get('/api/auctions/0000000000')
        .expect(404, { code: 'AUCTION_NOT_FOUND', context: {} });
    });
  });
});
