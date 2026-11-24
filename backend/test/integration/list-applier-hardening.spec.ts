// SPEC-004 part 2, the review's cases: the sweep guard, unknown values that never overwrite known
// ones, properties queued for a new collection, the order of the sweep, guards that must not leave a
// listed property unstamped, and the change entries read by time. Real MongoDB (Testcontainers),
// sanitizeFilter on (SC-10); only the clock is a fake (TS-06). Expectations worked out by hand.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { isActive } from '../../src/auctions/domain/active.js';
import { PhaseModality } from '../../src/auctions/domain/modality.js';
import {
  type ChunkWrites,
  ListApplierRepository,
} from '../../src/auctions/importer/list-applier.repository.js';
import {
  ListApplier,
  SweepAbortedError,
} from '../../src/auctions/importer/list-applier.service.js';
import { PropertyChangeService } from '../../src/auctions/changes/property-change.service.js';
import {
  PropertyChangeEntity,
  PropertyChangeSchema,
} from '../../src/auctions/changes/property-change.schema.js';
import {
  ImportRunEntity,
  ImportRunSchema,
} from '../../src/auctions/import-runs/import-run.schema.js';
import { AuctionEntity, AuctionSchema } from '../../src/auctions/schemas/auction.schema.js';
import { Decimal } from '../../src/common/money/money.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { DAY, FakeClock, HOUR } from '../fakes/fake-clock.js';
import { aRow, type ImportKit, importKit } from '../support/list-applier.js';
import { useTestDatabase } from '../support/test-database.js';

const START = new Date('2026-03-02T15:00:00.000Z');
const d = (value: string) => new Decimal(value);
const newRun = () => new Types.ObjectId().toHexString();
const online = (code: string, price: string) =>
  aRow(code, { modality: PhaseModality.ONLINE_SALES, minimumPrice: d(price) });
const codes = (count: number, from = 0) =>
  Array.from({ length: count }, (_, i) => online(`L${String(from + i).padStart(3, '0')}`, '1000'));

describe('ListApplier, the review cases (integration)', () => {
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

  const raw = (code: string) => kit.auctionModel.collection.findOne({ code });
  const unavailable = () => kit.auctionModel.countDocuments({ available: false });
  const entries = async (run: string) =>
    (await kit.changes.findByRun(run)).map((e) => `${e.propertyCode} ${e.type} ${e.field}`);

  /** A catalogue the old importer left: available, no run stamp, nothing the new fields know. */
  async function seedLegacy(count: number) {
    const phase = { modality: 'ONLINE_SALES', minimumPrice: Types.Decimal128.fromString('1000') };
    await kit.auctionModel.collection.insertMany(
      Array.from({ length: count }, (_, i) => ({
        code: `L${String(i).padStart(3, '0')}`,
        available: true,
        fulfilled: true,
        phases: [phase],
        currentPhase: phase,
        updatedAt: START,
      })),
    );
  }

  describe('the sweep guard (BR-004-08, DL-004-03)', () => {
    it('a first, truncated list over a legacy catalogue hides nothing and ends the run FAILED', async () => {
      await seedLegacy(100); // no baseline list: the catalogue itself is the baseline
      const run = newRun();

      await expect(
        kit.applier.apply({ runId: run, rows: codes(30), minRowRatio: 0.8 }),
      ).rejects.toBeInstanceOf(SweepAbortedError);

      expect(await unavailable()).toBe(0);
      expect(await entries(run)).toEqual([]); // not even a BECAME_UNAVAILABLE entry
      // The 30 listed rows were applied and stamped (harmless: they are on the list).
      expect(
        await kit.auctionModel.countDocuments({ lastSeenRunId: new Types.ObjectId(run) }),
      ).toBe(30);
    });

    it('allows exactly 1 - ratio of the catalogue to go: 20 of 100, not 21', async () => {
      await seedLegacy(100);

      const counts = await kit.applier.apply({
        runId: newRun(),
        rows: codes(80),
        minRowRatio: 0.8,
      });

      expect(counts.unavailable).toBe(20);
      expect(await unavailable()).toBe(20);

      await kit.auctionModel.deleteMany({});
      await seedLegacy(100);
      await expect(
        kit.applier.apply({ runId: newRun(), rows: codes(79), minRowRatio: 0.8 }),
      ).rejects.toBeInstanceOf(SweepAbortedError);
      expect(await unavailable()).toBe(0);
    });

    it('the name of the error is the failure code the Import Run records (SC-15)', () => {
      expect(new SweepAbortedError('x').name).toBe('SweepAbortedError');
    });

    it('counts the catalogue before the run writes: new properties of the run do not widen the limit', async () => {
      await seedLegacy(10);

      // 10 listed new properties would make 20 available if counted after; 9 of 10 legacy are absent.
      await expect(
        kit.applier.apply({ runId: newRun(), rows: codes(1, 100), minRowRatio: 0.8 }),
      ).rejects.toBeInstanceOf(SweepAbortedError);
    });
  });

  describe('unknown is not a change (BR-004-15)', () => {
    it('a list that leaves price, appraisal, description, address and link empty changes nothing', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1')], minRowRatio: 0 });
      const before = await raw('P1');
      clock.advance(DAY);
      const run = newRun();

      const counts = await kit.applier.apply({
        runId: run,
        rows: [
          aRow('P1', {
            title: null,
            address: {},
            appraisalPrice: null,
            minimumPrice: null,
            detailsUrl: null,
            propertyType: null,
          }),
        ],
        minRowRatio: 0,
      });

      expect(counts).toMatchObject({ new: 0, changed: 0, unavailable: 0 });
      expect(await entries(run)).toEqual([]);
      const after = await raw('P1');
      for (const field of [
        'title',
        'address',
        'appraisalPrice',
        'currentPhase',
        'detailsUrl',
        'propertyType',
        'updatedAt',
      ]) {
        expect(after?.[field]).toEqual(before?.[field]);
      }
    });
  });

  describe('a property to collect again (BR-004-09, BR-004-19)', () => {
    const PAST = new Date('2026-02-01T13:00:00.000Z');
    const staleRounds = [{ label: '1º Leilão', minimumPrice: null, date: PAST }];

    async function collected(code: string, rounds: unknown[] = staleRounds) {
      await kit.auctionModel.collection.updateOne(
        { code },
        { $set: { rounds, detailsCollectedAt: START, fulfilled: true } },
      );
    }

    it('a returned property with stale past rounds is collected first and active again', async () => {
      await kit.applier.apply({
        runId: newRun(),
        rows: [aRow('P1'), online('P2', '100')],
        minRowRatio: 0,
      });
      await collected('P2');
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1')], minRowRatio: 0 }); // P2 leaves
      expect((await raw('P2'))?.['available']).toBe(false);
      clock.advance(30 * DAY);

      await kit.applier.apply({
        runId: newRun(),
        rows: [aRow('P1'), online('P2', '100')],
        minRowRatio: 0,
      });

      const p2 = await raw('P2');
      expect(p2).toMatchObject({ available: true, fulfilled: false, detailsCollectedAt: null });
      expect(p2).not.toHaveProperty('rounds');
      expect(isActive({ available: true, rounds: p2?.['rounds'] ?? [] }, clock.now())).toBe(true);
      // ...whereas with the stale rounds kept it would have been stuck inactive.
      expect(isActive({ available: true, rounds: staleRounds }, clock.now())).toBe(false);
    });

    it('a modality change drops the rounds of the old modality and queues the collection', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1')], minRowRatio: 0 });
      await collected('P1', [
        { label: '2º Leilão', minimumPrice: null, date: new Date('2099-01-01T00:00:00Z') },
      ]);

      await kit.applier.apply({
        runId: newRun(),
        rows: [aRow('P1', { modality: PhaseModality.DIRECT_ONLINE_SALES })],
        minRowRatio: 0,
      });

      const p1 = await raw('P1');
      expect(p1).toMatchObject({ fulfilled: false, detailsCollectedAt: null });
      expect(p1).not.toHaveProperty('rounds');
    });

    it('a property still on the list whose every date has passed is collected again, silently', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1')], minRowRatio: 0 });
      await collected('P1');
      const before = await raw('P1');
      clock.advance(DAY);
      const run = newRun();

      const counts = await kit.applier.apply({ runId: run, rows: [aRow('P1')], minRowRatio: 0 });

      expect(counts.changed).toBe(0); // a refresh is not a change
      expect(await entries(run)).toEqual([]);
      const after = await raw('P1');
      expect(after).toMatchObject({ fulfilled: false, detailsCollectedAt: null });
      expect(after).not.toHaveProperty('rounds');
      expect(after?.['updatedAt']).toEqual(before?.['updatedAt']);
    });

    it('leaves a property with a date still ahead, or an open-ended round, alone', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1'), aRow('P2')], minRowRatio: 0 });
      await collected('P1', [
        { label: 'x', minimumPrice: null, date: new Date('2099-01-01T00:00:00Z') },
      ]);
      await collected('P2', [{ label: 'Venda Direta', minimumPrice: null, date: null }]);

      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1'), aRow('P2')], minRowRatio: 0 });

      for (const code of ['P1', 'P2']) {
        expect(await raw(code)).toMatchObject({ fulfilled: true, detailsCollectedAt: START });
        expect(await raw(code)).toHaveProperty('rounds');
      }
    });
  });

  describe('the order of the sweep (DL-004-04)', () => {
    it('writes the BECAME_UNAVAILABLE entries before any available:false flag', async () => {
      await kit.applier.apply({ runId: newRun(), rows: codes(10), minRowRatio: 0 });
      clock.advance(DAY);
      // A change-entry writer that dies exactly when the sweep's entries arrive.
      class DyingChanges extends PropertyChangeService {
        override record(...args: Parameters<PropertyChangeService['record']>) {
          if (args[1].some((entry) => entry.type === 'BECAME_UNAVAILABLE')) {
            return Promise.reject(new Error('the process died'));
          }
          return super.record(...args);
        }
      }
      const applier = new ListApplier(
        kit.properties,
        new DyingChanges(kit.changeRepository),
        clock,
      );

      await expect(
        applier.apply({ runId: newRun(), rows: codes(6), minRowRatio: 0 }),
      ).rejects.toThrow('the process died');

      // A flag written before its entry would show here: nothing was hidden.
      expect(await unavailable()).toBe(0);
    });

    it('markUnavailable never hides a property the run stamped (the lastSeenRunId guard)', async () => {
      const run = newRun();
      await kit.applier.apply({ runId: run, rows: codes(3), minRowRatio: 0 });

      await kit.properties.markUnavailable(new Types.ObjectId(run), ['L000', 'L001'], clock.now());

      expect(await unavailable()).toBe(0);
      // ...and it does hide one a different run stamped.
      await kit.properties.markUnavailable(new Types.ObjectId(), ['L000'], clock.now());
      expect((await raw('L000'))?.['available']).toBe(false);
      expect((await raw('L001'))?.['available']).toBe(true);
    });
  });

  describe('a duplicate code of an existing property (BR-004-05)', () => {
    it('is applied once, as its last row says, with one entry that matches the stored state', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [online('P2', '100000')], minRowRatio: 0 });
      clock.advance(DAY);
      const run = newRun();

      await kit.applier.apply({
        runId: run,
        rows: [online('P2', '95000'), online('P2', '80000')],
        minRowRatio: 0,
      });

      const [change] = await kit.changes.findByRun(run);
      expect(await entries(run)).toEqual(['P2 PRICE_DROPPED currentMinimumPrice']);
      expect(change).toMatchObject({ oldValue: '100000.00', newValue: '80000.00' });
      expect((await raw('P2'))?.['currentPhase'].minimumPrice).toEqual(
        Types.Decimal128.fromString('80000'),
      );
    });
  });

  describe('guards that must not unstamp a listed property (BR-004-08)', () => {
    /** A repository that moves the stored state between the read and the write, as a rival would. */
    class Racing extends ListApplierRepository {
      before: () => Promise<unknown> = () => Promise.resolve();
      override async applyChunk(writes: ChunkWrites): Promise<void> {
        await this.before();
        return super.applyChunk(writes);
      }
    }
    const racing = () => {
      const repository = new Racing(kit.auctionModel);
      return { repository, applier: new ListApplier(repository, kit.changes, clock) };
    };

    it('a modality guard that matches nothing still stamps the property: no false BECAME_UNAVAILABLE', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1')], minRowRatio: 0 });
      const { repository, applier } = racing();
      // Someone else already moved the modality after this attempt read it.
      repository.before = () =>
        kit.auctionModel.collection.updateOne(
          { code: 'P1' },
          { $set: { 'currentPhase.modality': 'OPEN_BIDDING' } },
        );
      const run = newRun();

      await applier.apply({
        runId: run,
        rows: [aRow('P1', { modality: PhaseModality.ONLINE_SALES })],
        minRowRatio: 0.5,
      });

      const p1 = await raw('P1');
      expect(p1?.['lastSeenRunId'].toHexString()).toBe(run);
      expect(p1?.['available']).toBe(true);
      expect(await entries(run)).not.toContain('P1 BECAME_UNAVAILABLE available');
      expect(p1?.['phases']).toHaveLength(1); // the guarded append was skipped
    });

    it('a price write after the scraper rewrote the phases updates only the current phase', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1')], minRowRatio: 0 });
      const { repository, applier } = racing();
      // The scraper rewrote `phases` wholesale: two entries now, not the one that was read.
      repository.before = () =>
        kit.auctionModel.collection.updateOne(
          { code: 'P1' },
          {
            $set: {
              phases: [
                { modality: 'OPEN_BIDDING', minimumPrice: Types.Decimal128.fromString('1') },
                { modality: 'SFI_AUCTION', minimumPrice: Types.Decimal128.fromString('150000') },
              ],
            },
          },
        );

      await applier.apply({
        runId: newRun(),
        rows: [aRow('P1', { minimumPrice: d('120000') })],
        minRowRatio: 0,
      });

      const p1 = await raw('P1');
      expect(p1?.['currentPhase'].minimumPrice).toEqual(Types.Decimal128.fromString('120000'));
      // Neither phase was priced by a stale index.
      expect(p1?.['phases'].map((p: { minimumPrice: unknown }) => String(p.minimumPrice))).toEqual([
        '1',
        '150000',
      ]);
    });

    it('RETURNED and BECAME_UNAVAILABLE of one run, one property: a retry with another list keeps both', async () => {
      const run = newRun();
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1'), aRow('P2')], minRowRatio: 0 });
      clock.advance(DAY);
      // Attempt 1 of the day: a list without P2 hides it...
      await kit.applier.apply({ runId: run, rows: [aRow('P1')], minRowRatio: 0 });
      expect((await raw('P2'))?.['available']).toBe(false);

      // ...attempt 2 of the same day, another list, has it back.
      await kit.applier.apply({ runId: run, rows: [aRow('P1'), aRow('P2')], minRowRatio: 0 });

      expect((await raw('P2'))?.['available']).toBe(true);
      expect(await entries(run)).toEqual([
        'P2 BECAME_UNAVAILABLE available',
        'P2 RETURNED available',
      ]);
    });
  });

  describe('reading the entries by time (BR-004-26, SPEC-008, SPEC-013)', () => {
    class Dying extends ListApplierRepository {
      calls = 0;
      override applyChunk(writes: ChunkWrites): Promise<void> {
        if (++this.calls === 2) return Promise.reject(new Error('the process died'));
        return super.applyChunk(writes);
      }
    }
    const rowsB = () => [
      aRow('P1', { minimumPrice: d('120000') }), // price drop
      aRow('P3', { minimumPrice: d('90000'), modality: PhaseModality.DIRECT_ONLINE_SALES }),
      online('P4', '80000'),
      online('P5', '70000'), // new
    ];

    it('entries a FAILED run wrote are read by the next cursor read, and not written again by the retry', async () => {
      await kit.applier.apply({
        runId: newRun(),
        rows: [aRow('P1'), online('P3', '90000'), online('P4', '80000')],
        minRowRatio: 0,
      });
      const first = await kit.changes.findSince(null);
      expect(first.items).toHaveLength(3); // the NEW entries of day 1
      clock.advance(DAY);
      const run = newRun();
      const dying = new ListApplier(new Dying(kit.auctionModel), kit.changes, clock);

      // Chunk 1 (P1, P3) is applied; chunk 2 (P4, P5) dies AFTER its entries were written (entries
      // go first), so the failed run already left the three entries a consumer is to read.
      await expect(
        dying.apply({ runId: run, rows: rowsB(), chunkSize: 2, minRowRatio: 0 }),
      ).rejects.toThrow();
      const afterFailure = await kit.changes.findSince(first.cursor);
      expect(afterFailure.items.map((e) => `${e.propertyCode} ${e.type}`).sort()).toEqual([
        'P1 PRICE_DROPPED',
        'P3 MODALITY_OR_ROUND_CHANGED',
        'P5 NEW',
      ]);

      // The retry the next hour applies the rest and writes none of them again: nothing is
      // delivered twice, and nothing the failed run wrote is lost.
      clock.advance(HOUR);
      await kit.applier.apply({ runId: run, rows: rowsB(), chunkSize: 2, minRowRatio: 0 });
      const afterRetry = await kit.changes.findSince(afterFailure.cursor);
      expect(afterRetry.items).toEqual([]);
      expect(await entries(run)).toHaveLength(3);
      expect((await raw('P5'))?.['available']).toBe(true);

      // Nothing new: the cursor stays where it was.
      const none = await kit.changes.findSince(afterRetry.cursor);
      expect(none).toEqual({ items: [], cursor: afterRetry.cursor });
    });

    it('can ask for the relevant entries only, and for a window of time', async () => {
      await kit.applier.apply({
        runId: newRun(),
        rows: [aRow('P1'), online('P2', '100')],
        minRowRatio: 0,
      });
      clock.advance(DAY);
      await kit.applier.apply({
        runId: newRun(),
        rows: [aRow('P1', { minimumPrice: d('160000') }), online('P2', '100')],
        minRowRatio: 0,
      });

      const all = await kit.changes.findSince(null, { relevantOnly: false });
      const relevant = await kit.changes.findSince(null);
      expect(all.items.map((e) => e.type)).toEqual(['NEW', 'NEW', 'PRICE_RAISED']);
      expect(relevant.items.map((e) => e.type)).toEqual(['NEW', 'NEW']); // a rise is history only

      const day2 = await kit.changes.findCreatedBetween(
        new Date(START.getTime() + HOUR),
        new Date(START.getTime() + 2 * DAY),
        { relevantOnly: false },
      );
      expect(day2.map((e) => e.type)).toEqual(['PRICE_RAISED']);
    });

    it('pages by the cursor, ties on the same instant broken by id, none repeated or skipped', async () => {
      await kit.applier.apply({ runId: newRun(), rows: codes(5), minRowRatio: 0 }); // one instant, five entries

      const seen: string[] = [];
      let cursor = null as Awaited<ReturnType<typeof kit.changes.findSince>>['cursor'];
      for (let page = 0; page < 4; page++) {
        const read = await kit.changes.findSince(cursor, { limit: 2 });
        seen.push(...read.items.map((e) => e.propertyCode));
        cursor = read.cursor;
      }

      expect([...seen].sort()).toEqual(['L000', 'L001', 'L002', 'L003', 'L004']);
      expect(new Set(seen).size).toBe(5);
    });
  });

  // BR-004-07 (review of #187): the unique key of an entry holds the run, and the next day's retry
  // of an interrupted import is a NEW run. Whatever the entry is (NEW, RETURNED,
  // BECAME_UNAVAILABLE, a price), an entry that repeats the newest of its field is not recorded
  // again, so a consumer reading by cursor is told once.
  describe('a replay under another run id records nothing twice (BR-004-07)', () => {
    class Dying extends ListApplierRepository {
      dyingApplyChunk = false;
      dyingMarkUnavailable = false;
      override applyChunk(writes: ChunkWrites): Promise<void> {
        if (this.dyingApplyChunk) return Promise.reject(new Error('the process died'));
        return super.applyChunk(writes);
      }
      override markUnavailable(...args: Parameters<ListApplierRepository['markUnavailable']>) {
        if (this.dyingMarkUnavailable) return Promise.reject(new Error('the process died'));
        return super.markUnavailable(...args);
      }
    }
    const history = async (code: string) =>
      (
        await kit.changeModel.find({ propertyCode: code }).sort({ createdAt: 1, _id: 1 }).lean()
      ).map((e) => `${e.type} ${String(e.oldValue)}>${String(e.newValue)}`);
    function dying() {
      const repository = new Dying(kit.auctionModel);
      return { repository, applier: new ListApplier(repository, kit.changes, clock) };
    }

    it('NEW: a first list whose property write died is replayed the next day with one NEW each', async () => {
      const { repository, applier } = dying();
      repository.dyingApplyChunk = true;
      await expect(
        applier.apply({ runId: newRun(), rows: [aRow('P1'), aRow('P2')], minRowRatio: 0 }),
      ).rejects.toThrow('the process died');
      expect(await kit.auctionModel.countDocuments()).toBe(0);
      clock.advance(DAY);

      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1'), aRow('P2')], minRowRatio: 0 });

      expect(await history('P1')).toEqual(['NEW null>true']);
      expect(await history('P2')).toEqual(['NEW null>true']);
      expect(await kit.auctionModel.countDocuments({ available: true })).toBe(2);
    });

    it('BECAME_UNAVAILABLE: a sweep that died after its entries is replayed the next day with one entry', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1'), aRow('P2')], minRowRatio: 0 });
      clock.advance(DAY);
      const { repository, applier } = dying();
      repository.dyingMarkUnavailable = true;
      await expect(
        applier.apply({ runId: newRun(), rows: [aRow('P1')], minRowRatio: 0 }),
      ).rejects.toThrow('the process died');
      expect((await raw('P2'))?.['available']).toBe(true);
      clock.advance(DAY);

      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1')], minRowRatio: 0 });

      expect(await history('P2')).toEqual(['NEW null>true', 'BECAME_UNAVAILABLE true>false']);
      expect((await raw('P2'))?.['available']).toBe(false);
    });

    it('RETURNED: a property back on the list whose write died is replayed the next day with one entry', async () => {
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1'), aRow('P2')], minRowRatio: 0 });
      clock.advance(DAY);
      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1')], minRowRatio: 0 });
      clock.advance(DAY);
      const { repository, applier } = dying();
      repository.dyingApplyChunk = true;
      await expect(
        applier.apply({ runId: newRun(), rows: [aRow('P1'), aRow('P2')], minRowRatio: 0 }),
      ).rejects.toThrow('the process died');
      clock.advance(DAY);

      await kit.applier.apply({ runId: newRun(), rows: [aRow('P1'), aRow('P2')], minRowRatio: 0 });

      expect(await history('P2')).toEqual([
        'NEW null>true',
        'BECAME_UNAVAILABLE true>false',
        'RETURNED false>true',
      ]);
    });

    it('a second, genuine, disappearance after a return is recorded: the entries between are not a repeat', async () => {
      const rows = [aRow('P1'), aRow('P2')];
      await kit.applier.apply({ runId: newRun(), rows, minRowRatio: 0 });
      for (const list of [[aRow('P1')], rows, [aRow('P1')]]) {
        clock.advance(DAY);
        await kit.applier.apply({ runId: newRun(), rows: list, minRowRatio: 0 });
      }

      expect(await history('P2')).toEqual([
        'NEW null>true',
        'BECAME_UNAVAILABLE true>false',
        'RETURNED false>true',
        'BECAME_UNAVAILABLE true>false',
      ]);
    });

    it('reads the newest entries of many properties and fields in one go, at most N each, newest first', async () => {
      const at = (offset: number) => new Date(START.getTime() + offset);
      const draft = (code: string, field: string, oldValue: string, newValue: string) => ({
        propertyCode: code,
        source: 'LIST' as const,
        type: 'OTHER_FIELD' as const,
        relevant: false,
        field,
        oldValue,
        newValue,
      });
      const run = newRun();
      for (let i = 0; i < 5; i++) {
        await kit.changes.record(newRun(), [draft('P1', 'f', `${i}`, `${i + 1}`)], at(i));
      }
      await kit.changes.record(
        run,
        [draft('P1', 'g', 'x', 'y'), draft('P2', 'f', 'a', 'b')],
        at(9),
      );

      const found = await kit.changeRepository.findRecentByFields(['P1', 'P2', 'P3'], ['f'], 3);

      expect([...found.keys()].sort()).toEqual(['P1', 'P2']);
      expect(
        found
          .get('P1')
          ?.get('f')
          ?.map((e) => e.newValue),
      ).toEqual(['5', '4', '3']);
      expect(found.get('P1')?.has('g')).toBe(false);
      expect(found.get('P2')?.get('f')).toEqual([
        { type: 'OTHER_FIELD', oldValue: 'a', newValue: 'b' },
      ]);
      expect(await kit.changeRepository.findRecentByFields([], ['f'], 3)).toEqual(new Map());
      expect(await kit.changeRepository.findRecentByFields(['P1'], [], 3)).toEqual(new Map());
    });
  });
});
