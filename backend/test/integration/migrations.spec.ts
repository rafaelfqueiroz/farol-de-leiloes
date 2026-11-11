// Integration (AR-29, #34): the migrations runner with its MongoDB log, and 0001-money-decimal128
// against a real MongoDB (TESTING §1: Decimal128 cannot be proven against a mock). Documents are
// seeded through the driver in the shapes written before #34 — prices as BSON double, int and
// long, coupons in integer centavos — next to documents already in the new shape and nulls. The
// expected values are hand-computed (TS-04).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, mongo, Types } from 'mongoose';
import { toAuction } from '../../src/auctions/auction.mapper';
import {
  conditionalUpdate,
  convertMoneyToDecimal128,
} from '../../src/migrations/0001-money-decimal128.migration';
import {
  PriceBoundConflictError,
  renameSavedFilterPriceBounds,
} from '../../src/migrations/0002-saved-filter-price-bounds.migration';
import type { Migration } from '../../src/migrations/migration';
import { MIGRATIONS_COLLECTION, mongoMigrationLog } from '../../src/migrations/migration-log';
import { MigrationFailedError, runMigrations } from '../../src/migrations/migration-runner';
import { MIGRATIONS } from '../../src/migrations/registry';
import { FakeClock } from '../fakes/fake-clock';
import { useTestDatabase } from '../support/test-database';

const NOW = new Date('2026-11-03T12:00:00.000Z');
const LATER = new Date('2026-11-04T12:00:00.000Z');
const PHASE_DATE = new Date('2026-03-03T13:00:00.000Z');
const USER = new Types.ObjectId('64b7f0000000000000000a01');
const d128 = (value: string) => Types.Decimal128.fromString(value);
// 0001 alone: its describe asserts the shapes it leaves, before 0002 renames the bounds (#81).
const ONLY_0001 = MIGRATIONS.slice(0, 1);

describe('Migrations (integration)', () => {
  const testDb = useTestDatabase();
  let connection: Connection;
  let db: mongo.Db;

  const all = async (name: string) => db.collection(name).find({}).sort({ _id: 1 }).toArray();
  const snapshot = async () => ({
    auctions: await all('auctions'),
    coupons: await all('coupons'),
    savedfilters: await all('savedfilters'),
  });
  const byKey = async (name: string, key: string, value: string) =>
    db.collection(name).findOne({ [key]: value });

  beforeAll(async () => {
    connection = await createConnection(testDb.uri).asPromise();
    // Mongoose 9 types `connection.db` as possibly undefined; after asPromise() it is set.
    if (!connection.db) throw new Error('connection has no db');
    db = connection.db;

    await db.collection('auctions').insertMany([
      {
        code: 'LEGACY',
        appraisalPrice: 91589.89, // BSON double
        phases: [
          {
            modality: 'SFI_AUCTION',
            minimumPrice: 74628.94,
            phaseDates: [PHASE_DATE],
            paymentMethods: ['FGTS'],
            expenseRules: [{ type: 'Condomínio', description: 'Comprador' }],
          },
          { modality: 'OPEN_BIDDING', minimumPrice: null },
          { modality: 'ONLINE_SALES', minimumPrice: 130000 }, // BSON int
        ],
        currentPhase: { modality: 'ONLINE_SALES', minimumPrice: 130000 },
        updatedAt: NOW,
      },
      {
        code: 'LONG',
        appraisalPrice: mongo.Long.fromNumber(250000), // BSON long
        phases: [],
        updatedAt: NOW,
      },
      {
        code: 'CONVERTED',
        appraisalPrice: d128('99999.99'),
        phases: [{ modality: 'ONLINE_SALES', minimumPrice: d128('80000.10') }],
        currentPhase: { modality: 'ONLINE_SALES', minimumPrice: d128('80000.10') },
        updatedAt: NOW,
      },
      { code: 'NULLS', appraisalPrice: null, phases: [], currentPhase: null, updatedAt: NOW },
    ]);
    await db.collection('coupons').insertMany([
      { code: 'LEGADO', discountValue: 1050, active: true }, // int: 1050 centavos
      { code: 'DOUBLE', discountValue: new mongo.Double(1000), active: true }, // double centavos
      { code: 'NOVO', discountValue: d128('19.99'), active: true }, // written in reais by #34
    ]);
    await db.collection('savedfilters').insertMany([
      {
        userId: USER,
        name: 'Legado',
        filters: { city: ['Natal'], minMargin: 100000, maxMargin: 250000.5 },
      },
      { userId: USER, name: 'Novo', filters: { maxMargin: d128('300000.5') } },
      { userId: USER, name: 'Sem limites', filters: { minMargin: null, state: 'RN' } },
    ]);
  });

  afterAll(async () => {
    await connection.close();
  });

  describe('0001-money-decimal128, through the runner', () => {
    let afterFirstRun: Awaited<ReturnType<typeof snapshot>>;
    let converted: Awaited<ReturnType<typeof snapshot>>['auctions'];

    beforeAll(async () => {
      const before = await snapshot();
      await expect(
        runMigrations(db, ONLY_0001, mongoMigrationLog(db), new FakeClock(NOW)),
      ).resolves.toEqual({ applied: ['0001-money-decimal128'], skipped: [] });
      afterFirstRun = await snapshot();
      converted = before.auctions.filter((doc) => doc.code === 'CONVERTED');
    });

    it('converts auction prices to the same reais as Decimal128, keeping everything else', async () => {
      const legacy = await byKey('auctions', 'code', 'LEGACY');

      expect(legacy?.appraisalPrice).toEqual(d128('91589.89'));
      expect(legacy?.appraisalPrice.toString()).toBe('91589.89');
      expect(legacy?.phases).toEqual([
        {
          modality: 'SFI_AUCTION',
          minimumPrice: d128('74628.94'),
          phaseDates: [PHASE_DATE],
          paymentMethods: ['FGTS'],
          expenseRules: [{ type: 'Condomínio', description: 'Comprador' }],
        },
        { modality: 'OPEN_BIDDING', minimumPrice: null },
        { modality: 'ONLINE_SALES', minimumPrice: d128('130000') },
      ]);
      expect(legacy?.currentPhase).toEqual({
        modality: 'ONLINE_SALES',
        minimumPrice: d128('130000'),
      });
      expect((await byKey('auctions', 'code', 'LONG'))?.appraisalPrice).toEqual(d128('250000'));
    });

    it('leaves Decimal128 and null prices exactly as they were', async () => {
      expect(afterFirstRun.auctions.filter((doc) => doc.code === 'CONVERTED')).toEqual(converted);
      const nulls = await byKey('auctions', 'code', 'NULLS');
      expect(nulls).toMatchObject({ appraisalPrice: null, phases: [], currentPhase: null });
    });

    it('converts coupon discounts from integer centavos to reais, once', async () => {
      // 1050 / 100 = 10.50; 1000 / 100 = 10.00; 19.99 was already reais.
      expect((await byKey('coupons', 'code', 'LEGADO'))?.discountValue.toString()).toBe('10.50');
      expect((await byKey('coupons', 'code', 'DOUBLE'))?.discountValue.toString()).toBe('10.00');
      expect((await byKey('coupons', 'code', 'NOVO'))?.discountValue).toEqual(d128('19.99'));
    });

    it('converts saved filter bounds, leaving null and absent bounds alone', async () => {
      expect((await byKey('savedfilters', 'name', 'Legado'))?.filters).toEqual({
        city: ['Natal'],
        minMargin: d128('100000'),
        maxMargin: d128('250000.5'),
      });
      expect((await byKey('savedfilters', 'name', 'Novo'))?.filters).toEqual({
        maxMargin: d128('300000.5'),
      });
      expect((await byKey('savedfilters', 'name', 'Sem limites'))?.filters).toEqual({
        minMargin: null,
        state: 'RN',
      });
    });

    it('leaves documents the contract-step readers accept', async () => {
      const legacy = await byKey('auctions', 'code', 'LEGACY');
      const auction = toAuction(legacy as unknown as Parameters<typeof toAuction>[0]);

      expect(auction.appraisalPrice?.toFixed()).toBe('91589.89');
      expect(auction.phases.map((phase) => phase.minimumPrice?.toFixed() ?? null)).toEqual([
        '74628.94',
        null,
        '130000',
      ]);
    });

    it('records the id once, with the clock time; a second run skips it and changes nothing', async () => {
      await expect(
        runMigrations(db, ONLY_0001, mongoMigrationLog(db), new FakeClock(LATER)),
      ).resolves.toEqual({ applied: [], skipped: ['0001-money-decimal128'] });

      expect(await all(MIGRATIONS_COLLECTION)).toEqual([
        { _id: '0001-money-decimal128', appliedAt: NOW },
      ]);
      expect(await snapshot()).toEqual(afterFirstRun);
    });

    it('is idempotent on its own: run again without its record, it rewrites 0 documents', async () => {
      await expect(convertMoneyToDecimal128(db)).resolves.toEqual({
        auctions: 0,
        coupons: 0,
        savedfilters: 0,
      });
      expect(await snapshot()).toEqual(afterFirstRun);
    });
  });

  describe('the conditional write', () => {
    it('does not rewrite a value that changed since it was read', async () => {
      const { insertedId } = await db
        .collection('coupons')
        .insertOne({ code: 'RACE', discountValue: 2000 });
      // Read as 2000; meanwhile another writer stored 2500.
      await db
        .collection('coupons')
        .updateOne({ _id: insertedId }, { $set: { discountValue: 2500 } });

      const result = await db
        .collection('coupons')
        .bulkWrite([
          conditionalUpdate(insertedId, [{ path: 'discountValue', from: 2000, to: d128('20.00') }]),
        ]);

      expect(result.modifiedCount).toBe(0);
      expect((await db.collection('coupons').findOne({ _id: insertedId }))?.discountValue).toBe(
        2500,
      );
    });

    it('does not take a Decimal128 for the equal number (no second division by 100)', async () => {
      const { insertedId } = await db
        .collection('coupons')
        .insertOne({ code: 'EQUAL', discountValue: d128('1000') });

      const result = await db
        .collection('coupons')
        .bulkWrite([
          conditionalUpdate(insertedId, [{ path: 'discountValue', from: 1000, to: d128('10.00') }]),
        ]);

      expect(result.modifiedCount).toBe(0);
      expect((await db.collection('coupons').findOne({ _id: insertedId }))?.discountValue).toEqual(
        d128('1000'),
      );
    });
  });

  describe('the runner with the MongoDB log', () => {
    it('stops at a failing migration and does not record it', async () => {
      const failing: Migration = {
        id: '0099-always-fails',
        description: 'fails on purpose',
        up: async () => {
          throw new Error('boom');
        },
      };
      const never: Migration = {
        id: '0100-never-runs',
        description: 'must not run',
        up: async () => {
          await db.collection('never').insertOne({ ran: true });
        },
      };

      await expect(
        runMigrations(
          db,
          [...ONLY_0001, failing, never],
          mongoMigrationLog(db),
          new FakeClock(LATER),
        ),
      ).rejects.toBeInstanceOf(MigrationFailedError);

      const ids = (await all(MIGRATIONS_COLLECTION)).map((doc) => doc._id);
      expect(ids).toEqual(['0001-money-decimal128']);
      expect(await db.collection('never').countDocuments()).toBe(0);
    });

    it('refuses to record an id twice (the unique _id)', async () => {
      await expect(mongoMigrationLog(db).record('0001-money-decimal128', LATER)).rejects.toThrow(
        /E11000/,
      );
    });
  });

  describe('0001 then 0002-saved-filter-price-bounds, through the runner (#81)', () => {
    const ALL = ['0001-money-decimal128', '0002-saved-filter-price-bounds'];
    let afterFirstRun: Awaited<ReturnType<typeof snapshot>>;

    beforeAll(async () => {
      await db.collection('savedfilters').deleteMany({});
      await db.collection(MIGRATIONS_COLLECTION).deleteMany({});
      await db.collection('savedfilters').insertMany([
        {
          userId: USER,
          name: 'Ambos',
          filters: { city: ['Natal'], minMargin: 100000, maxMargin: 250000.5 },
        },
        { userId: USER, name: 'So maximo', filters: { maxMargin: 300000.5 } },
        { userId: USER, name: 'So minimo nulo', filters: { minMargin: null, state: 'RN' } },
        {
          userId: USER,
          name: 'Ja renomeado',
          filters: { minPrice: d128('50000'), maxPrice: d128('90000.5') },
        },
        { userId: USER, name: 'Sem limites', filters: { state: 'SP' } },
      ]);
      const result = await runMigrations(db, MIGRATIONS, mongoMigrationLog(db), new FakeClock(NOW));
      expect(result).toEqual({ applied: ALL, skipped: [] });
      afterFirstRun = await snapshot();
    });

    it('renames the bounds, keeping their Decimal128 values, nulls and other criteria', async () => {
      expect((await byKey('savedfilters', 'name', 'Ambos'))?.filters).toEqual({
        city: ['Natal'],
        minPrice: d128('100000'),
        maxPrice: d128('250000.5'),
      });
      expect((await byKey('savedfilters', 'name', 'So maximo'))?.filters).toEqual({
        maxPrice: d128('300000.5'),
      });
      expect((await byKey('savedfilters', 'name', 'So minimo nulo'))?.filters).toEqual({
        minPrice: null,
        state: 'RN',
      });
    });

    it('leaves already-renamed documents and documents without bounds alone', async () => {
      expect((await byKey('savedfilters', 'name', 'Ja renomeado'))?.filters).toEqual({
        minPrice: d128('50000'),
        maxPrice: d128('90000.5'),
      });
      expect((await byKey('savedfilters', 'name', 'Sem limites'))?.filters).toEqual({
        state: 'SP',
      });
    });

    it('a second run skips both and changes nothing; 0002 alone rewrites 0 documents', async () => {
      await expect(
        runMigrations(db, MIGRATIONS, mongoMigrationLog(db), new FakeClock(LATER)),
      ).resolves.toEqual({ applied: [], skipped: ALL });
      expect(await snapshot()).toEqual(afterFirstRun);

      await expect(renameSavedFilterPriceBounds(db)).resolves.toEqual({
        'filters.minPrice': 0,
        'filters.maxPrice': 0,
      });
      expect(await snapshot()).toEqual(afterFirstRun);
    });

    it('stops on a document holding both names, writing nothing', async () => {
      await db.collection('savedfilters').insertMany([
        { userId: USER, name: 'Legado ok', filters: { maxMargin: d128('1') } },
        { userId: USER, name: 'Conflito', filters: { minMargin: d128('1'), minPrice: d128('2') } },
      ]);
      const before = await snapshot();

      await expect(renameSavedFilterPriceBounds(db)).rejects.toBeInstanceOf(
        PriceBoundConflictError,
      );
      expect(await snapshot()).toEqual(before);
    });
  });
});
