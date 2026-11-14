// HTTP contract of the saved-filter endpoints (TESTING §2): pagination (AR-35) and the nested
// request DTO (AR-34), with SavedFiltersService stubbed and the signed-in user faked.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { SavedFiltersController } from './saved-filters.controller.js';
import { SavedFiltersService } from './saved-filters.service.js';
import { createHttpApp, TEST_USER } from '../../test/support/http-app.js';
import { itAnswersPages } from '../../test/support/pagination-contract.js';
import type { SavedFilter } from './interfaces/saved-filter.interface.js';
import { Decimal } from '../common/money/money.js';

const FILTER: SavedFilter = {
  _id: '64b7f00000000000000000aa',
  name: 'Natal até 300 mil',
  filters: { state: 'RN', city: ['Natal'], maxPrice: new Decimal('300000') },
  createdAt: new Date('2026-01-15T12:00:00.000Z'),
};

describe('SavedFiltersController over HTTP', () => {
  const savedFilters = { findPage: vi.fn(), create: vi.fn(), delete: vi.fn() };
  let app: INestApplication;

  beforeAll(async () => {
    app = await createHttpApp({
      controllers: [SavedFiltersController],
      providers: [{ provide: SavedFiltersService, useValue: savedFilters }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/saved-filters', () => {
    itAnswersPages({
      app: () => app,
      path: '/api/saved-filters',
      method: savedFilters.findPage,
      pageArg: 1,
      item: FILTER,
      expectedItem: {
        ...FILTER,
        // AR-17: the price bound leaves as a string of reais.
        filters: { state: 'RN', city: ['Natal'], maxPrice: '300000.00' },
        createdAt: '2026-01-15T12:00:00.000Z',
      },
    });
  });

  describe('POST /api/saved-filters', () => {
    it('stores only the known criteria and answers the saved filter', async () => {
      savedFilters.create.mockResolvedValue(FILTER);

      await request(app.getHttpServer())
        .post('/api/saved-filters')
        .send({ name: FILTER.name, filters: { state: 'RN', city: ['Natal'], maxPrice: '300000' } })
        .expect(201);

      // AR-17: the money string reaches the service as a Decimal, never a float.
      expect(savedFilters.create).toHaveBeenCalledWith(TEST_USER.userId, FILTER.name, {
        state: 'RN',
        city: ['Natal'],
        maxPrice: new Decimal('300000'),
      });
    });

    it('AR-17: refuses a price sent as a JSON number or a pt-BR string', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/saved-filters')
        .send({ name: 'x', filters: { minPrice: 300000, maxPrice: '300.000,00' } })
        .expect(400);

      expect([...response.body.context.fields].sort()).toEqual([
        'filters.maxPrice',
        'filters.minPrice',
      ]);
      expect(savedFilters.create).not.toHaveBeenCalled();
    });

    it('SC-10 / AR-34: refuses a forged Decimal object as VALIDATION_FAILED, not a 500', async () => {
      savedFilters.create.mockClear();

      await request(app.getHttpServer())
        .post('/api/saved-filters')
        .send({ name: 'x', filters: { minPrice: { toStringTag: '[object Decimal]' } } })
        .expect(400, { code: 'VALIDATION_FAILED', context: { fields: ['filters.minPrice'] } });

      expect(savedFilters.create).not.toHaveBeenCalled();
    });

    it('AR-34: validates the nested filters, naming each offending path', async () => {
      const response = await request(app.getHttpServer())
        .post('/api/saved-filters')
        .send({ name: '', filters: { city: 'Natal', minPrice: 'cheap', $where: '1' } })
        .expect(400);

      expect(response.body.code).toBe('VALIDATION_FAILED');
      expect([...response.body.context.fields].sort()).toEqual(
        ['filters.$where', 'filters.city', 'filters.minPrice', 'name'].sort(),
      );
      expect(savedFilters.create).not.toHaveBeenCalled();
    });

    it('AR-34: refuses a body without filters', async () => {
      await request(app.getHttpServer())
        .post('/api/saved-filters')
        .send({ name: 'x' })
        .expect(400, { code: 'VALIDATION_FAILED', context: { fields: ['filters'] } });
    });
  });
});
