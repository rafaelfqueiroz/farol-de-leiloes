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
import { AuctionsService } from '../../src/auctions/auctions.service';
import {
  AuctionEntity,
  AuctionSchema,
  PhaseModality,
} from '../../src/auctions/schemas/auction.schema';
import { Clock } from '../../src/common/clock/clock';
import { Decimal } from '../../src/common/money/money';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety';
import { CouponsService } from '../../src/coupons/coupons.service';
import { CouponEntity, CouponSchema } from '../../src/coupons/schemas/coupon.schema';
import { PaymentGateway } from '../../src/payments/payment-gateway';
import { SavedFiltersService } from '../../src/saved-filters/saved-filters.service';
import {
  SavedFilterEntity,
  SavedFilterSchema,
} from '../../src/saved-filters/schemas/saved-filter.schema';
import { FakeClock } from '../fakes/fake-clock';
import { FakePaymentGateway } from '../fakes/fake-payment-gateway';
import { useTestDatabase } from '../support/test-database';
import { testBusinessConfig, testConfigService } from '../support/test-env';
import businessConfig from '../../src/config/business.config';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const USER = new Types.ObjectId('64b7f0000000000000000a01');
const PAGE = { page: 1, pageSize: 20 };

// 34 significant digits, more than a double holds (~15–17): only Decimal128 keeps them all.
const PRECISE = '1234567890123.123456789012345678901';

describe('Money round trip through MongoDB (integration)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let auctions: AuctionsService;
  let coupons: CouponsService;
  let savedFilters: SavedFiltersService;
  let auctionModel: Model<AuctionEntity>;
  let couponModel: Model<CouponEntity>;
  let savedFilterModel: Model<SavedFilterEntity>;

  beforeAll(async () => {
    applyMongooseDefaults(); // as in production (SC-10)
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([
          { name: AuctionEntity.name, schema: AuctionSchema },
          { name: CouponEntity.name, schema: CouponSchema },
          { name: SavedFilterEntity.name, schema: SavedFilterSchema },
        ]),
      ],
      providers: [
        AuctionsService,
        CouponsService,
        SavedFiltersService,
        { provide: Clock, useValue: new FakeClock(NOW) },
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
    await auctionModel.syncIndexes();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  describe('auctions', () => {
    beforeAll(async () => {
      await auctions.upsertMany([
        {
          code: 'NEW',
          appraisalPrice: new Decimal(PRECISE),
          phases: [{ modality: PhaseModality.ONLINE_SALES, minimumPrice: new Decimal('91589.89') }],
        },
        {
          code: 'OLDER',
          appraisalPrice: new Decimal('130000'),
          phases: [{ modality: PhaseModality.ONLINE_SALES, minimumPrice: new Decimal('74628.94') }],
        },
      ]);
    });

    it('stores every price as Decimal128 (AR-17)', async () => {
      const raw = await auctionModel.collection.findOne({ code: 'NEW' });

      expect(raw?.appraisalPrice).toBeInstanceOf(Types.Decimal128);
      expect(raw?.currentPhase.minimumPrice).toBeInstanceOf(Types.Decimal128);
      expect(raw?.phases[0].minimumPrice).toBeInstanceOf(Types.Decimal128);
    });

    it('reads back the exact Decimal, 34 digits included, lean and hydrated', async () => {
      const hydrated = await auctions.findByCode('NEW');
      const [lean] = await auctions.findAvailableByCodes(['NEW']);

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

    it('writes the stored phases back as read when the importer appends a phase', async () => {
      await auctions.upsertMany([
        {
          code: 'OLDER',
          phases: [{ modality: PhaseModality.SFI_AUCTION, minimumPrice: new Decimal('70000') }],
        },
      ]);

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
      await savedFilters.create(USER.toString(), 'Até 300 mil', {
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

      const page = await savedFilters.findPage(USER.toString(), PAGE);
      const byName = new Map(page.items.map((filter) => [filter.name, filter.filters]));
      expect(byName.get('Migrado')).toEqual({
        city: ['Natal'],
        maxPrice: new Decimal('250000.5'),
      });
      expect(byName.get('Até 300 mil')?.maxPrice?.toFixed()).toBe('300000.5');
    });
  });
});
