// SPEC-004 BR-004-05..10, BR-004-15, BR-004-17, BR-004-25..27, DL-004-04: the daily list applied to a
// real MongoDB (Testcontainers) under the production setting (sanitizeFilter on, SC-10). Only the
// clock is a fake (TS-06). Every expectation is worked out by hand from the rules.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { toAuction } from '../../src/auctions/auction.mapper.js';
import { PhaseModality } from '../../src/auctions/domain/modality.js';
import { isActive } from '../../src/auctions/domain/active.js';
import { ListApplier } from '../../src/auctions/importer/list-applier.service.js';
import {
  ListApplierRepository,
  type ChunkWrites,
} from '../../src/auctions/importer/list-applier.repository.js';
import { AuctionEntity, AuctionSchema } from '../../src/auctions/schemas/auction.schema.js';
import {
  ImportRunEntity,
  ImportRunSchema,
} from '../../src/auctions/import-runs/import-run.schema.js';
import {
  PropertyChangeEntity,
  PropertyChangeSchema,
} from '../../src/auctions/changes/property-change.schema.js';
import { Decimal } from '../../src/common/money/money.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { DAY, FakeClock } from '../fakes/fake-clock.js';
import { aRow, type ImportKit, importKit } from '../support/list-applier.js';
import { useTestDatabase } from '../support/test-database.js';

const START = new Date('2026-03-02T15:00:00.000Z');
const d = (value: string) => new Decimal(value);
const newRun = () => new Types.ObjectId().toHexString();

/** Lists of the scenario: P1 (SFI 150000), P2..P4 online sales at 100000, 90000, 80000. */
const online = (code: string, price: string) =>
  aRow(code, { modality: PhaseModality.ONLINE_SALES, minimumPrice: d(price) });
const listA = () => [
  aRow('P1'),
  online('P2', '100000'),
  online('P3', '90000'),
  online('P4', '80000'),
];

describe('ListApplier (integration)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let kit: ImportKit;
  const clock = new FakeClock(START);

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([
          { name: AuctionEntity.name, schema: AuctionSchema },
          { name: ImportRunEntity.name, schema: ImportRunSchema },
          { name: PropertyChangeEntity.name, schema: PropertyChangeSchema },
        ]),
      ],
    }).compile();
    kit = importKit(moduleRef, clock);
    await kit.auctionModel.syncIndexes();
    await kit.changeModel.syncIndexes();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    clock.set(START);
    await kit.auctionModel.deleteMany({});
    await kit.changeModel.deleteMany({});
  });

  /** The catalogue as a spec compares it: availability, price and phases per code. */
  async function catalogue() {
    const docs = await kit.auctionModel.find({}).sort({ code: 1 }).lean();
    return docs.map((doc) => ({
      code: doc.code,
      available: doc.available,
      modality: doc.currentPhase?.modality,
      price: doc.currentPhase?.minimumPrice?.toString(),
      phases: (doc.phases ?? []).map((p) => `${p.modality}:${p.minimumPrice?.toString()}`),
    }));
  }
  const entriesOf = async (runId: string) =>
    (await kit.changes.findByRun(runId)).map((e) => `${e.propertyCode} ${e.type} ${e.field}`);

  describe('a first list (BR-004-06)', () => {
    it('stores every property with its list fields, one phase, and one NEW entry each', async () => {
      const run = newRun();

      const counts = await kit.applier.apply({ runId: run, rows: listA() });

      expect(counts).toEqual({ new: 4, changed: 0, unavailable: 0, active: 4 });
      expect(await catalogue()).toEqual([
        {
          code: 'P1',
          available: true,
          modality: 'SFI_AUCTION',
          price: '150000',
          phases: ['SFI_AUCTION:150000'],
        },
        {
          code: 'P2',
          available: true,
          modality: 'ONLINE_SALES',
          price: '100000',
          phases: ['ONLINE_SALES:100000'],
        },
        {
          code: 'P3',
          available: true,
          modality: 'ONLINE_SALES',
          price: '90000',
          phases: ['ONLINE_SALES:90000'],
        },
        {
          code: 'P4',
          available: true,
          modality: 'ONLINE_SALES',
          price: '80000',
          phases: ['ONLINE_SALES:80000'],
        },
      ]);
      expect(await entriesOf(run)).toEqual([
        'P1 NEW available',
        'P2 NEW available',
        'P3 NEW available',
        'P4 NEW available',
      ]);
      const raw = await kit.auctionModel.collection.findOne({ code: 'P1' });
      expect(raw?.['lastSeenRunId'].toHexString()).toBe(run);
      expect(raw?.['listSeenAt']).toEqual(START);
      expect(raw?.['createdAt']).toEqual(START);
    });

    it('BR-004-15: a property first seen is "not collected yet", never a default', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1')] });

      const raw = await kit.auctionModel.collection.findOne({ code: 'P1' });
      // Nothing the list does not carry was written: no rounds, no payment methods, no photos.
      expect(raw).not.toHaveProperty('rounds');
      expect(raw).not.toHaveProperty('paymentMethods');
      expect(raw).not.toHaveProperty('image');
      expect(raw?.['detailsCollectedAt'] ?? null).toBeNull();
      expect(raw?.['occupancy'] ?? null).toBeNull();
      const auction = toAuction(raw as never);
      expect(auction.rounds).toEqual([]);
      expect(auction.occupancy).toBeNull();
      expect(auction.detailsCollectedAt).toBeNull();
      expect(auction.currentPhase?.paymentMethods).toBeUndefined();
      // Not collected is active, not hidden (BR-004-16 as documented).
      expect(isActive({ available: auction.available, rounds: auction.rounds }, START)).toBe(true);
    });

    it('stores the property type fallback and the money as Decimal128 (AR-17)', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1', { propertyType: 'Casa' })] });

      const raw = await kit.auctionModel.collection.findOne({ code: 'P1' });
      expect(raw?.['propertyType']).toBe('Casa');
      expect(raw?.['appraisalPrice']).toEqual(Types.Decimal128.fromString('200000'));
      expect(raw?.['currentPhase'].minimumPrice).toEqual(Types.Decimal128.fromString('150000'));
    });

    it('applies a code listed twice once, as its last row says', async () => {
      const counts = await kit.applier.apply({
        runId: newRun(),
        rows: [online('P2', '100000'), online('P2', '95000')],
      });

      expect(counts.new).toBe(1);
      expect((await catalogue())[0]?.price).toBe('95000');
    });

    it('skips a new row whose modality is unknown, without hiding anything', async () => {
      const run = newRun();
      const counts = await kit.applier.apply({
        runId: run,
        rows: [aRow('P1'), aRow('PX', { modality: null })],
      });

      expect(counts.new).toBe(1);
      expect((await catalogue()).map((p) => p.code)).toEqual(['P1']);
    });
  });

  describe('applying the same list again (BR-004-07)', () => {
    it('as a later run: zero new, changed and unavailable, no new entry, updatedAt untouched', async () => {
      await kit.applier.apply({ runId: newRun(), rows: listA() });
      const before = await kit.auctionModel.collection.find({}).sort({ code: 1 }).toArray();
      clock.advance(DAY);
      const second = newRun();

      const counts = await kit.applier.apply({ runId: second, rows: listA() });

      expect(counts).toEqual({ new: 0, changed: 0, unavailable: 0, active: 4 });
      expect(await entriesOf(second)).toEqual([]);
      const after = await kit.auctionModel.collection.find({}).sort({ code: 1 }).toArray();
      for (const [index, doc] of after.entries()) {
        expect(doc['updatedAt']).toEqual(before[index]?.['updatedAt']);
        // Stamped as seen by the second run, on the second day.
        expect(doc['lastSeenRunId'].toHexString()).toBe(second);
        expect(doc['listSeenAt']).toEqual(new Date(START.getTime() + DAY));
      }
    });

    it('with the same run: the same counts and still one entry of each', async () => {
      const run = newRun();
      const first = await kit.applier.apply({ runId: run, rows: listA() });
      const again = await kit.applier.apply({ runId: run, rows: listA() });

      expect(again).toEqual(first);
      expect(await entriesOf(run)).toHaveLength(4);
      expect(await kit.auctionModel.countDocuments()).toBe(4);
    });
  });

  describe('a list that changes things (BR-004-06, BR-004-08, BR-004-09, BR-004-25, BR-004-26)', () => {
    /** B: P1 price dropped, P2 gone, P3 address changed, P4 unchanged, P5 new. */
    const listB = () => [
      aRow('P1', { minimumPrice: d('120000.5') }),
      aRow('P3', {
        modality: PhaseModality.ONLINE_SALES,
        minimumPrice: d('90000'),
        address: { street: 'RUA NOVA, 9', neighborhood: 'CENTRO', city: 'CAMPINAS', state: 'SP' },
      }),
      online('P4', '80000'),
      online('P5', '70000'),
    ];

    it('records exactly the tracked changes and counts them', async () => {
      await kit.applier.apply({ runId: newRun(), rows: listA() });
      clock.advance(DAY);
      const run = newRun();

      const counts = await kit.applier.apply({ runId: run, rows: listB() });

      // P1 changed (price) and P3 changed (address, untracked: no entry); P2 left; P5 new.
      expect(counts).toEqual({ new: 1, changed: 2, unavailable: 1, active: 4 });
      expect(await entriesOf(run)).toEqual([
        'P1 PRICE_DROPPED currentMinimumPrice',
        'P2 BECAME_UNAVAILABLE available',
        'P5 NEW available',
      ]);
      const drop = (await kit.changes.findByRun(run)).find((e) => e.propertyCode === 'P1');
      expect(drop).toMatchObject({
        source: 'LIST',
        relevant: true,
        oldValue: '150000.00',
        newValue: '120000.50',
        createdAt: new Date(START.getTime() + DAY),
      });
      expect(await catalogue()).toEqual([
        {
          code: 'P1',
          available: true,
          modality: 'SFI_AUCTION',
          price: '120000.5',
          phases: ['SFI_AUCTION:120000.5'],
        },
        {
          code: 'P2',
          available: false,
          modality: 'ONLINE_SALES',
          price: '100000',
          phases: ['ONLINE_SALES:100000'],
        },
        {
          code: 'P3',
          available: true,
          modality: 'ONLINE_SALES',
          price: '90000',
          phases: ['ONLINE_SALES:90000'],
        },
        {
          code: 'P4',
          available: true,
          modality: 'ONLINE_SALES',
          price: '80000',
          phases: ['ONLINE_SALES:80000'],
        },
        {
          code: 'P5',
          available: true,
          modality: 'ONLINE_SALES',
          price: '70000',
          phases: ['ONLINE_SALES:70000'],
        },
      ]);
      const p3 = await kit.auctionModel.collection.findOne({ code: 'P3' });
      expect(p3?.['address'].street).toBe('RUA NOVA, 9');
    });

    it('a property back on a later list is RETURNED with its new modality and price (BR-004-09)', async () => {
      await kit.applier.apply({ runId: newRun(), rows: listA() });
      clock.advance(DAY);
      await kit.applier.apply({ runId: newRun(), rows: listB() }); // P2 leaves
      clock.advance(28 * DAY);
      const run = newRun();

      const counts = await kit.applier.apply({
        runId: run,
        rows: [
          ...listB(),
          aRow('P2', { modality: PhaseModality.DIRECT_ONLINE_SALES, minimumPrice: d('85000') }),
        ],
      });

      expect(counts).toEqual({ new: 0, changed: 1, unavailable: 0, active: 5 });
      expect(await entriesOf(run)).toEqual([
        'P2 RETURNED available',
        'P2 PRICE_DROPPED currentMinimumPrice',
        'P2 MODALITY_OR_ROUND_CHANGED modality',
      ]);
      const p2 = await kit.auctionModel.collection.findOne({ code: 'P2' });
      expect(p2?.['available']).toBe(true);
      expect(p2?.['currentPhase']).toEqual({
        modality: 'DIRECT_ONLINE_SALES',
        minimumPrice: Types.Decimal128.fromString('85000'),
        phaseDates: [], // as the importer always wrote it: the dates come from the detail page
      });
      // The history of modality periods grows by one phase.
      expect(p2?.['phases'].map((p: { modality: string }) => p.modality)).toEqual([
        'ONLINE_SALES',
        'DIRECT_ONLINE_SALES',
      ]);
    });

    it('a modality change appends a phase and the current price follows the list (BR-004-06)', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1')] });
      const run = newRun();

      await kit.applier.apply({
        runId: run,
        rows: [aRow('P1', { modality: PhaseModality.OPEN_BIDDING, minimumPrice: d('150000') })],
      });

      expect(await entriesOf(run)).toEqual(['P1 MODALITY_OR_ROUND_CHANGED modality']);
      expect((await catalogue())[0]).toMatchObject({
        modality: 'OPEN_BIDDING',
        phases: ['SFI_AUCTION:150000', 'OPEN_BIDDING:150000'],
      });
    });

    it('keeps what the detail collection wrote: rounds, payment methods and the details date', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1')] });
      const rounds = [
        { label: '1º Leilão', minimumPrice: null, date: new Date('2026-03-10T13:00:00Z') },
      ];
      await kit.auctionModel.collection.updateOne(
        { code: 'P1' },
        {
          $set: {
            rounds,
            detailsCollectedAt: START,
            occupancy: 'OCCUPIED',
            propertyType: 'Residência',
            'currentPhase.paymentMethods': ['FGTS'],
          },
        },
      );

      await kit.applier.apply({
        runId: newRun(),
        rows: [aRow('P1', { minimumPrice: d('140000'), propertyType: 'Casa' })],
      });

      const raw = await kit.auctionModel.collection.findOne({ code: 'P1' });
      expect(raw?.['rounds']).toEqual(rounds);
      expect(raw?.['occupancy']).toBe('OCCUPIED');
      expect(raw?.['detailsCollectedAt']).toEqual(START);
      expect(raw?.['propertyType']).toBe('Residência'); // the page's value over the list's fallback
      expect(raw?.['currentPhase'].paymentMethods).toEqual(['FGTS']);
      expect(raw?.['currentPhase'].minimumPrice).toEqual(Types.Decimal128.fromString('140000'));
    });
  });

  describe('BR-004-17: nothing is ever deleted', () => {
    it('a property absent for weeks stays stored, unavailable, with its history', async () => {
      const first = newRun();
      await kit.applier.apply({ runId: first, rows: listA() });
      for (let week = 1; week <= 5; week++) {
        clock.advance(7 * DAY);
        await kit.applier.apply({ runId: newRun(), rows: [aRow('P1')] }); // the others are gone
      }

      const p3 = await kit.auctionModel.collection.findOne({ code: 'P3' });
      expect(p3).toMatchObject({ code: 'P3', available: false });
      expect(p3?.['title']).toBe('Casa, 60 m2 (P3)');
      const history = await kit.changes.findByCode('P3');
      expect(history.map((e) => e.type)).toEqual(['BECAME_UNAVAILABLE', 'NEW']);
      // Reachable by its number 35 days later, with the price it had (AC: 30 days).
      expect(toAuction(p3 as never).currentPhase?.minimumPrice?.toString()).toBe('90000');
      expect(await kit.auctionModel.countDocuments()).toBe(4);
    });
  });

  describe('a run that dies (BR-004-07, BR-004-08, DL-004-04)', () => {
    /** B again, bigger: P1 dropped, P2 gone, P3 modality changed, P4 same, P5 and P6 new. */
    const listB = () => [
      aRow('P1', { minimumPrice: d('120000') }),
      aRow('P3', { modality: PhaseModality.DIRECT_ONLINE_SALES, minimumPrice: d('90000') }),
      online('P4', '80000'),
      online('P5', '70000'),
      online('P6', '60000'),
    ];
    const FINAL_ENTRIES = [
      'P1 PRICE_DROPPED currentMinimumPrice',
      'P2 BECAME_UNAVAILABLE available',
      'P3 MODALITY_OR_ROUND_CHANGED modality',
      'P5 NEW available',
      'P6 NEW available',
    ];
    const FINAL_COUNTS = { new: 2, changed: 2, unavailable: 1, active: 5 };

    /** A repository that fails the Nth call of a method, once. */
    class Flaky extends ListApplierRepository {
      calls = { applyChunk: 0, markUnavailable: 0 };
      failAt: { applyChunk?: number; markUnavailable?: number } = {};

      override applyChunk(writes: ChunkWrites): Promise<void> {
        this.calls.applyChunk++;
        if (this.failAt.applyChunk === this.calls.applyChunk) {
          return Promise.reject(new Error('the process died'));
        }
        return super.applyChunk(writes);
      }

      override markUnavailable(...args: Parameters<ListApplierRepository['markUnavailable']>) {
        this.calls.markUnavailable++;
        if (this.failAt.markUnavailable === this.calls.markUnavailable) {
          return Promise.reject(new Error('the process died'));
        }
        return super.markUnavailable(...args);
      }
    }

    function flakyApplier(failAt: Flaky['failAt']) {
      const repository = new Flaky(kit.auctionModel);
      repository.failAt = failAt;
      return new ListApplier(repository, kit.changes, clock);
    }

    async function stateOfDay2() {
      return {
        catalogue: await catalogue(),
        entries: (await kit.changes.findByRun(run)).map((e) => [
          e.propertyCode,
          e.type,
          e.field,
          e.oldValue,
          e.newValue,
        ]),
      };
    }

    let run: string;

    beforeEach(async () => {
      await kit.applier.apply({ runId: newRun(), rows: listA() });
      clock.advance(DAY);
      run = newRun();
    });

    /** The final state an uninterrupted day-2 run leaves, applied to an identical day 1. */
    async function uninterrupted() {
      await kit.applier.apply({ runId: run, rows: listB(), chunkSize: 2 });
      return stateOfDay2();
    }

    it.each([
      ['a chunk of properties fails to write (chunk 2 of 3)', { applyChunk: 2 }],
      ['the very first chunk fails to write', { applyChunk: 1 }],
      ['the unavailable marking fails after its entries were written', { markUnavailable: 1 }],
    ] as const)(
      '%s: nothing is hidden meanwhile, and the retry ends as an uninterrupted run',
      async (_name, failAt) => {
        const dying = flakyApplier(failAt);

        await expect(dying.apply({ runId: run, rows: listB(), chunkSize: 2 })).rejects.toThrow(
          'the process died',
        );

        // BR-004-07/08: no property was marked unavailable by the dead run.
        expect((await catalogue()).find((p) => p.code === 'P2')?.available).toBe(true);
        expect(await kit.auctionModel.countDocuments({ available: false })).toBe(0);

        const counts = await kit.applier.apply({ runId: run, rows: listB(), chunkSize: 2 });

        expect(counts).toEqual(FINAL_COUNTS);
        expect(await entriesOf(run)).toEqual(FINAL_ENTRIES);
        const interrupted = await stateOfDay2();

        // The same final state as a run nothing interrupted, on the same starting point.
        await kit.auctionModel.deleteMany({});
        await kit.changeModel.deleteMany({});
        clock.set(START);
        await kit.applier.apply({ runId: newRun(), rows: listA() });
        clock.advance(DAY);
        expect(await uninterrupted()).toEqual(interrupted);
      },
    );

    it('a retry of a finished run leaves everything as it was (idempotent to the end)', async () => {
      await kit.applier.apply({ runId: run, rows: listB(), chunkSize: 2 });
      const once = await stateOfDay2();

      const counts = await kit.applier.apply({ runId: run, rows: listB(), chunkSize: 3 });

      expect(counts).toEqual(FINAL_COUNTS);
      expect(await stateOfDay2()).toEqual(once);
    });

    it('a failed write never leaves a change applied without its entry', async () => {
      // Chunk 1 is P1 and P3 (the two changed rows): its write dies.
      const dying = flakyApplier({ applyChunk: 1 });
      await expect(dying.apply({ runId: run, rows: listB(), chunkSize: 2 })).rejects.toThrow();

      // The entries came first, so the retry's diff still sees the change and writes it.
      expect(await entriesOf(run)).toEqual(
        expect.arrayContaining([
          'P1 PRICE_DROPPED currentMinimumPrice',
          'P3 MODALITY_OR_ROUND_CHANGED modality',
        ]),
      );
      expect((await catalogue()).find((p) => p.code === 'P1')?.price).toBe('150000');
    });
  });

  describe('two applies of the same list at once (BR-004-07)', () => {
    it('converge: one document per property, one entry of each, no phase twice', async () => {
      await kit.applier.apply({ runId: newRun(), rows: listA() });
      clock.advance(DAY);
      const run = newRun();
      const rows = [
        aRow('P1', { minimumPrice: d('120000') }),
        aRow('P2', { modality: PhaseModality.DIRECT_ONLINE_SALES, minimumPrice: d('100000') }),
        online('P3', '90000'),
        online('P7', '50000'),
        online('P8', '40000'),
      ];

      const [one, other] = await Promise.all([
        kit.applier.apply({ runId: run, rows, chunkSize: 2 }),
        kit.applier.apply({ runId: run, rows, chunkSize: 2 }),
      ]);

      const settled = await kit.applier.apply({ runId: run, rows, chunkSize: 2 });
      expect(settled).toEqual({ new: 2, changed: 2, unavailable: 1, active: 5 });
      expect(one.new).toBeLessThanOrEqual(2);
      expect(other.new).toBeLessThanOrEqual(2);
      expect(await kit.auctionModel.countDocuments()).toBe(6);
      expect(await entriesOf(run)).toEqual([
        'P1 PRICE_DROPPED currentMinimumPrice',
        'P2 MODALITY_OR_ROUND_CHANGED modality',
        'P4 BECAME_UNAVAILABLE available',
        'P7 NEW available',
        'P8 NEW available',
      ]);
      const p2 = await kit.auctionModel.collection.findOne({ code: 'P2' });
      expect(p2?.['phases']).toHaveLength(2);
    });

    it('converge on an empty catalogue too', async () => {
      const run = newRun();

      await Promise.all([
        kit.applier.apply({ runId: run, rows: listA(), chunkSize: 1 }),
        kit.applier.apply({ runId: run, rows: listA(), chunkSize: 1 }),
      ]);

      expect(await kit.auctionModel.countDocuments()).toBe(4);
      expect(await entriesOf(run)).toHaveLength(4);
      expect(await kit.changes.countByType(run, 'NEW')).toBe(4);
    });
  });
});
