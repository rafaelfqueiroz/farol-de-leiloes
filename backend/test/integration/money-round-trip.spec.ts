// Integration: Decimal128 ⇄ Decimal against a real MongoDB (Testcontainers, TESTING §1 — this
// cannot be proven against a mock). Every writer stores Decimal128; every reader returns the
// exact Decimal it was given, lean or hydrated. Documents written before #34 — money as a JS
// number, coupons in centavos — are converted by the migration (migrations.spec.ts).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Model, Types } from 'mongoose';
import { AuctionsService } from '../../src/auctions/auctions.service.js';
import {
  AuctionEntity,
  AuctionSchema,
  PhaseModality,
} from '../../src/auctions/schemas/auction.schema.js';
import {
  ImportRunEntity,
  ImportRunSchema,
} from '../../src/auctions/import-runs/import-run.schema.js';
import {
  PropertyChangeEntity,
  PropertyChangeSchema,
} from '../../src/auctions/changes/property-change.schema.js';
import { Clock } from '../../src/common/clock/clock.js';
import { Decimal } from '../../src/common/money/money.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { CouponsService } from '../../src/coupons/coupons.service.js';
import { CouponEntity, CouponSchema } from '../../src/coupons/schemas/coupon.schema.js';
import { PaymentGateway } from '../../src/payments/payment-gateway.js';
import { SavedFiltersService } from '../../src/saved-filters/saved-filters.service.js';
import { SavedFiltersRepository } from '../../src/saved-filters/saved-filters.repository.js';
import { anAccessContext } from '../fakes/fake-access-sources.js';
import {
  SavedFilterEntity,
  SavedFilterSchema,
} from '../../src/saved-filters/schemas/saved-filter.schema.js';
import { FakeClock } from '../fakes/fake-clock.js';
import { FakePaymentGateway } from '../fakes/fake-payment-gateway.js';
import { aRow, type ImportKit, importKit } from '../support/list-applier.js';
import { useTestDatabase } from '../support/test-database.js';
import { testBusinessConfig, testConfigService } from '../support/test-env.js';
import businessConfig from '../../src/config/business.config.js';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const USER = new Types.ObjectId('64b7f0000000000000000a01');
const ctx = await anAccessContext(USER.toHexString()); // SPEC-002: services take the context
const PAGE = { page: 1, pageSize: 20 };

// 34 significant digits, more than a double holds (~15–17): only Decimal128 keeps them all.
const PRECISE = '1234567890123.123456789012345678901';

describe('Money round trip through MongoDB (integration)', () => {
  const clock = new FakeClock(NOW);
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let auctions: AuctionsService;
  let coupons: CouponsService;
  let savedFilters: SavedFiltersService;
  let auctionModel: Model<AuctionEntity>;
  let kit: ImportKit;
  let couponModel: Model<CouponEntity>;
  let savedFilterModel: Model<SavedFilterEntity>;

  beforeAll(async () => {
    applyMongooseDefaults(); // as in production (SC-10)
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([
          { name: AuctionEntity.name, schema: AuctionSchema },
          { name: ImportRunEntity.name, schema: ImportRunSchema },
          { name: PropertyChangeEntity.name, schema: PropertyChangeSchema },
          { name: CouponEntity.name, schema: CouponSchema },
          { name: SavedFilterEntity.name, schema: SavedFilterSchema },
        ]),
      ],
      providers: [
        AuctionsService,
        CouponsService,
        SavedFiltersService,
        SavedFiltersRepository,
        { provide: Clock, useValue: clock },
        { provide: PaymentGateway, useValue: new FakePaymentGateway() },
        { provide: CACHE_MANAGER, useValue: {} },
        { provide: ConfigService, useValue: testConfigService() },
        { provide: businessConfig.KEY, useValue: testBusinessConfig() },
      ],
    }).compile();
    auctions = moduleRef.get(AuctionsService);
    coupons = moduleRef.get(CouponsService);
    savedFilters = moduleRef.get(SavedFiltersService);
    auctionModel = moduleRef.get(getModelToken(AuctionEntity.name));
    couponModel = moduleRef.get(getModelToken(CouponEntity.name));
    savedFilterModel = moduleRef.get(getModelToken(SavedFilterEntity.name));
    kit = importKit(moduleRef, clock);
    await auctionModel.syncIndexes();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('auctions', () => {
    beforeAll(async () => {
      // The writer of the daily list (SPEC-004): the prices go in through it.
      await kit.applier.apply({
        minRowRatio: 0,
        runId: new Types.ObjectId().toHexString(),
        rows: [
          aRow('NEW', {
            appraisalPrice: new Decimal(PRECISE),
            minimumPrice: new Decimal('91589.89'),
            modality: PhaseModality.ONLINE_SALES,
          }),
          aRow('OLDER', {
            appraisalPrice: new Decimal('130000'),
            minimumPrice: new Decimal('74628.94'),
            modality: PhaseModality.ONLINE_SALES,
          }),
        ],
      });
    });

    it('stores every price as Decimal128 (AR-17)', async () => {
      const raw = await auctionModel.collection.findOne({ code: 'NEW' });

      expect(raw?.appraisalPrice).toBeInstanceOf(Types.Decimal128);
      expect(raw?.currentPhase.minimumPrice).toBeInstanceOf(Types.Decimal128);
      expect(raw?.phases[0].minimumPrice).toBeInstanceOf(Types.Decimal128);
    });

    it('reads back the exact Decimal, 34 digits included, lean and hydrated', async () => {
      const hydrated = await auctions.findByCode('NEW');
      const [lean] = await auctions.findByCodes(['NEW']);

      for (const auction of [hydrated, lean]) {
        expect(auction?.appraisalPrice?.toFixed()).toBe(PRECISE);
        expect(auction?.currentPhase?.minimumPrice?.toFixed()).toBe('91589.89');
      }
    });

    it('filters by price with inclusive Decimal128 bounds', async () => {
      const codes = async (min: string, max: string) =>
        (
          await auctions.query({ minPrice: new Decimal(min), maxPrice: new Decimal(max) }, PAGE)
        ).items
          .map((auction) => auction.code)
          .sort();

      await expect(codes('74628.94', '91589.89')).resolves.toEqual(['NEW', 'OLDER']);
      await expect(codes('74628.95', '91589.89')).resolves.toEqual(['NEW']);
      await expect(codes('0', '91589.88')).resolves.toEqual(['OLDER']);
    });

    it('keeps the stored phases as they were when the importer appends a phase', async () => {
      await kit.applier.apply({
        minRowRatio: 0,
        runId: new Types.ObjectId().toHexString(),
        rows: [
          aRow('NEW', {
            appraisalPrice: new Decimal(PRECISE),
            minimumPrice: new Decimal('91589.89'),
            modality: PhaseModality.ONLINE_SALES,
          }),
          aRow('OLDER', {
            appraisalPrice: new Decimal('130000'),
            minimumPrice: new Decimal('70000'),
            modality: PhaseModality.SFI_AUCTION,
          }),
        ],
      });

      const raw = await auctionModel.collection.findOne({ code: 'OLDER' });
      expect(raw?.phases.map((phase: { minimumPrice: unknown }) => phase.minimumPrice)).toEqual([
        Types.Decimal128.fromString('74628.94'),
        Types.Decimal128.fromString('70000'),
      ]);
      const auction = await auctions.findByCode('OLDER');
      expect(auction?.phases.map((phase) => phase.minimumPrice?.toFixed())).toEqual([
        '74628.94',
        '70000',
      ]);
    });
  });

  describe('a property that left the list (BR-004-17, BR-004-13, BR-004-14)', () => {
    it('is still reachable by its number, with read-time state and money as strings', async () => {
      const rows = [
        aRow('GONE', {
          appraisalPrice: new Decimal('200000'),
          minimumPrice: new Decimal('150000'),
          modality: PhaseModality.SFI_AUCTION,
        }),
      ];
      await kit.applier.apply({ minRowRatio: 0, runId: new Types.ObjectId().toHexString(), rows });
      // The collector's rounds: 1st at 10h00 on 2026-03-10, 2nd a week later (Brasília).
      await auctionModel.collection.updateOne(
        { code: 'GONE' },
        {
          $set: {
            rounds: [
              {
                label: '1º Leilão',
                minimumPrice: Types.Decimal128.fromString('150000'),
                date: new Date('2026-03-10T13:00:00Z'),
              },
              {
                label: '2º Leilão',
                minimumPrice: Types.Decimal128.fromString('120000'),
                date: new Date('2026-03-16T13:00:00Z'),
              },
            ],
          },
        },
      );
      // The next list does not have it: swept, and 30 days pass.
      await kit.applier.apply({
        minRowRatio: 0,
        runId: new Types.ObjectId().toHexString(),
        rows: [aRow('KEEP')],
      });
      clock.set(new Date('2026-04-15T12:00:00.000Z'));

      const found = await auctions.findByCode('GONE');

      expect(found).toMatchObject({ code: 'GONE', available: false, active: false });
      expect(found?.currentMinimumPrice?.toFixed(2)).toBe('150000.00'); // no round left: the list price stands
      expect(found?.discountPercent?.toFixed(2)).toBe('25.00');
      // The same lookup the favorites page makes returns it too, flagged.
      const [again] = await auctions.findByCodes(['GONE']);
      expect(again?.available).toBe(false);
      // Search lists only what is active.
      const listed = await auctions.query({}, PAGE);
      expect(listed.items.map((item) => item.code)).not.toContain('GONE');
    });

    it('switches the price at 10h00 of the second round, with no import (the clock decides)', async () => {
      await auctionModel.collection.updateOne({ code: 'GONE' }, { $set: { available: true } });

      clock.set(new Date('2026-03-10T12:59:00.000Z'));
      const before = await auctions.findByCode('GONE');
      clock.set(new Date('2026-03-10T13:00:00.000Z'));
      const after = await auctions.findByCode('GONE');

      expect([
        before?.currentMinimumPrice?.toFixed(2),
        before?.discountPercent?.toFixed(2),
      ]).toEqual(['150000.00', '25.00']);
      expect([after?.currentMinimumPrice?.toFixed(2), after?.discountPercent?.toFixed(2)]).toEqual([
        '120000.00',
        '40.00',
      ]);
      expect([before?.active, after?.active]).toEqual([true, true]);
    });
  });

  describe('coupons (discountValue converted in place: centavos → reais)', () => {
    it('stores a new coupon in Decimal128 reais and reads it back exactly', async () => {
      const created = await coupons.create({
        code: 'novo',
        discountValue: new Decimal('19.99'),
        validTo: '2026-12-31',
      });

      const raw = await couponModel.collection.findOne({ code: 'NOVO' });
      expect(raw?.discountValue).toEqual(Types.Decimal128.fromString('19.99'));
      expect(created.discountValue.toFixed()).toBe('19.99');
      await expect(coupons.validateCoupon('novo')).resolves.toMatchObject({
        discountValue: new Decimal('19.99'),
      });
    });

    it('reads a coupon the #34 migration converted (1050 centavos → 10.50) as R$ 10,50', async () => {
      await couponModel.collection.insertOne({
        code: 'MIGRADO',
        discountValue: Types.Decimal128.fromString('10.50'),
        validTo: new Date('2026-12-31T03:00:00.000Z'),
        active: true,
        createdAt: NOW,
        updatedAt: NOW,
      });

      const coupon = await coupons.validateCoupon('migrado');
      expect(coupon.discountValue.toFixed(2)).toBe('10.50');
    });
  });

  describe('saved filters', () => {
    it('stores the price bounds as Decimal128 and reads them back exactly', async () => {
      await savedFilters.create(ctx, 'Até 300 mil', {
        state: 'RN',
        maxPrice: new Decimal('300000.50'),
      });

      const raw = await savedFilterModel.collection.findOne({ name: 'Até 300 mil' });
      expect(raw?.filters.maxPrice).toEqual(Types.Decimal128.fromString('300000.5'));
      expect(raw?.filters).not.toHaveProperty('minPrice');
    });

    it('reads stored bounds back digit for digit, and a null bound as absent', async () => {
      await savedFilterModel.collection.insertOne({
        userId: USER,
        name: 'Migrado',
        filters: {
          city: ['Natal'],
          minPrice: null,
          maxPrice: Types.Decimal128.fromString('250000.5'),
        },
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
        updatedAt: NOW,
      });

      const page = await savedFilters.findPage(ctx, PAGE);
      const byName = new Map(page.items.map((filter) => [filter.name, filter.filters]));
      expect(byName.get('Migrado')).toEqual({
        city: ['Natal'],
        maxPrice: new Decimal('250000.5'),
      });
      expect(byName.get('Até 300 mil')?.maxPrice?.toFixed()).toBe('300000.5');
    });
  });
});
