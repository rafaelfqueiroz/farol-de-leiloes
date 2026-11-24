// SPEC-004 BR-004-23, part 3's fencing and part 4's seam: what the completion path does around the
// collection pass. The REAL orchestrator on MongoDB; the pass and the round clock are hand-written
// fakes that record what they were asked (TS-03).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { brasiliaInstant } from '../../src/auctions/domain/import-schedule.js';
import type { RoundClockService } from '../../src/auctions/enrichment/round-clock.service.js';
import { csvList, HH, properties } from '../support/detail-run.js';
import { createImportHarness, type ImportHarness } from '../support/import-harness.js';
import { useTestDatabase } from '../support/test-database.js';

const MON = '2026-11-23';

describe('the completion path around the collection pass (integration)', () => {
  const db = useTestDatabase();
  let h: ImportHarness;

  beforeAll(async () => {
    h = await createImportHarness(db.uri, brasiliaInstant(MON, HH(5)));
  });
  afterAll(async () => {
    await h.moduleRef.close();
  });
  beforeEach(async () => {
    await h.kit.auctionModel.deleteMany({});
    await h.kit.changeModel.deleteMany({});
    await h.kit.runModel.deleteMany({});
    await h.csvUploads.deleteMany({});
    h.storage.files.clear();
    h.caixa.reset();
    h.events.length = 0;
    h.enrichment.calls.length = 0;
    h.enrichment.inputs.length = 0;
    h.enrichment.result = { collected: 0, failed: 0, blocked: false, pages: 0, requests: 0 };
    h.enrichment.failWith = null;
    h.enrichment.hook = null;
    h.caixa.serveList(csvList(MON, properties(3)));
    h.clock.set(brasiliaInstant(MON, HH(6)));
  });

  it('keeps what the pass saved before it failed: the run does not fall back to zeros', async () => {
    h.enrichment.hook = async (input) => {
      await input.saveProgress({ collected: 2, failed: 1, blocked: false, pages: 3, requests: 5 });
    };
    h.enrichment.failWith = new Error('a fault after some pages');

    await h.orchestrator().tick();

    const run = await h.kit.runs.findByDate(MON);
    expect(run?.collection).toEqual({
      collected: 2,
      failed: 1,
      blocked: false,
      pages: 3,
      requests: 5,
    });
    expect(run?.updateCompletedAt).not.toBeNull(); // the update does not wait on an enrichment fault
  });

  it('checks the lease again before the round clock, and does not run it for a worker that lost the run', async () => {
    const record = vi.fn(() => Promise.resolve(0));
    const clock = { record } as unknown as RoundClockService;
    // The lease is taken from the worker right after the pass result was stored.
    const saved = h.kit.runs.saveCollection.bind(h.kit.runs);
    const spy = vi.spyOn(h.kit.runs, 'saveCollection').mockImplementation(async (...args) => {
      const written = await saved(...args);
      await h.kit.runModel.updateOne(
        { brasiliaDate: MON },
        { $set: { leaseOwner: 'another-worker', leaseExpiresAt: new Date('2099-01-01') } },
      );
      return written;
    });

    await h.orchestrator({}, { roundClock: clock }).tick();
    spy.mockRestore();

    expect(record).not.toHaveBeenCalled();
    expect((await h.kit.runs.findByDate(MON))?.updateCompletedAt).toBeNull();
    expect(h.events).toEqual([]);
  });

  it('runs the round clock once for the worker that holds the run, before the signal', async () => {
    const order: string[] = [];
    const record = vi.fn(async () => {
      order.push('clock');
      return 0;
    });
    h.bus.subscribe(() => {
      order.push('signal');
    });

    await h.orchestrator({}, { roundClock: { record } as unknown as RoundClockService }).tick();

    expect(record).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['clock', 'signal']);
  });
});
