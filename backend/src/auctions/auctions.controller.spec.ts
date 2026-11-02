// HTTP-level spec of the list filters' query parsing, through the real Nest + Express stack with
// supertest. Express 5 (Nest 12, #61) replaced the `extended` (qs) query parser with `simple`
// (node:querystring): a repeated key still becomes an array, but bracket syntax no longer nests.
// The controller parses lists explicitly (repeated keys or comma-separated values), so the app
// keeps Express 5's default parser; these tests pin that contract.
//
// supertest binds the app to an ephemeral loopback port in this process; nothing leaves the
// machine (TS-01, TS-07). AuctionsService is replaced by a stub: only the arguments the controller
// hands it are under test, and the service has no port yet (TS-03).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuctionsController } from './auctions.controller';
import { AuctionsService } from './auctions.service';

const LIST_FILTERS = ['city', 'neighborhood', 'modality'] as const;

describe('AuctionsController over HTTP (Express 5 query parsing)', () => {
  const auctions = {
    query: vi.fn(),
    getNeighborhoods: vi.fn(),
  };
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuctionsController],
      providers: [{ provide: AuctionsService, useValue: auctions }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api'); // as in main.ts
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    auctions.query.mockResolvedValue({ total: 0, items: [] });
    auctions.getNeighborhoods.mockResolvedValue([]);
  });

  function lastQueryFilters(): Record<string, unknown> {
    expect(auctions.query).toHaveBeenCalledTimes(1);
    return auctions.query.mock.calls[0]?.[0] as Record<string, unknown>;
  }

  describe('GET /api/auctions list filters', () => {
    it.each(LIST_FILTERS)('reads a repeated %s key as a list', async (name) => {
      await request(app.getHttpServer())
        .get(`/api/auctions?${name}=A&${name}=B`)
        .expect(200, { total: 0, items: [] });

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

    it('does not nest bracket keys: the simple parser leaves `city[]` as its own key', async () => {
      await request(app.getHttpServer()).get('/api/auctions?city[]=A&city[]=B').expect(200);

      expect(lastQueryFilters().city).toBeUndefined();
    });

    it('turns state, margins and paging into the service filters', async () => {
      await request(app.getHttpServer())
        .get('/api/auctions?state=SP&minMargin=10&maxMargin=40&limit=500&offset=20')
        .expect(200);

      // limit is capped at 200.
      expect(lastQueryFilters()).toMatchObject({
        state: 'SP',
        minMargin: 10,
        maxMargin: 40,
        take: 200,
        skip: 20,
      });
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

    it('answers 400 without a city', async () => {
      await request(app.getHttpServer()).get('/api/auctions/neighborhoods?state=SP').expect(400);

      expect(auctions.getNeighborhoods).not.toHaveBeenCalled();
    });
  });
});
