// SPEC-004 BR-004-13, BR-004-14, BR-004-25, BR-004-26, BR-004-23 (part 4): the changes the CLOCK
// makes, recorded inside the daily update before it completes. The acceptance case: an SFI
// property with its 1st round on D at 10h00 and its 2nd on D+6 at 10h00 (Brasília) changes round
// between two daily runs, with no list and no page saying so. Real orchestrator and MongoDB; the
// clock, Caixa, the mail and R2 are fakes. The server's own zone plays no part (the specs of the
// zone matrix cover the pure rule: domain/sfi-rounds.spec.ts).
//
// Calendar (Brasília): 2026-11-23 Monday, 11-24 Tuesday (D, the 1st round ends 10h00),
// 11-30 Monday (D+6, the 2nd round ends 10h00).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { brasiliaInstant } from '../../src/auctions/domain/import-schedule.js';
import { RoundClockService } from '../../src/auctions/enrichment/round-clock.service.js';
import { detailPage } from '../support/detail-pages.js';
import {
  csvList,
  entriesOf,
  HH,
  MODALITY,
  pageUrl,
  properties,
  runDay,
  stored,
} from '../support/detail-run.js';
import { createImportHarness, type ImportHarness } from '../support/import-harness.js';
import { spyOnLogger } from '../support/logger-spy.js';
import { useTestDatabase } from '../support/test-database.js';

const MON = '2026-11-23';
const TUE = '2026-11-24';
const WED = '2026-11-25';
const NEXT_MON = '2026-11-30';

describe('the changes the clock makes (integration)', () => {
  const db = useTestDatabase();
  let h: ImportHarness;

  beforeAll(async () => {
    h = await createImportHarness(db.uri, brasiliaInstant(MON, HH(5)));
  });

  afterAll(async () => {
    await h.moduleRef.close();
  });

  const five = () => properties(5, MODALITY.sfi);
  const list = (day: string) => csvList(day, five());

  beforeEach(async () => {
    await h.kit.auctionModel.deleteMany({});
    await h.kit.changeModel.deleteMany({});
    await h.kit.runModel.deleteMany({});
    await h.csvUploads.deleteMany({});
    h.storage.files.clear();
    h.copyStorage.publicFiles.clear();
    h.copyStorage.privateFiles.clear();
    h.caixa.reset();
    h.email.importAlertEmails.length = 0;
    h.events.length = 0;
    h.clock.set(brasiliaInstant(MON, HH(5)));
    // 0001: 1st round ends Tuesday 10h00, the 2nd Monday 10h00 (the next week).
    h.caixa.serveDetailPage(
      pageUrl('0001'),
      detailPage({
        sfiDates: ['24/11/2026 - 10h00', '30/11/2026 - 10h00'],
        firstPrice: '192.622,00',
        secondPrice: '170.201,84',
        photos: [],
        edital: null,
        matricula: null,
      }),
    );
    // The others end in December: nothing for the clock to do before then.
    for (const code of ['0002', '0003', '0004', '0005']) {
      h.caixa.serveDetailPage(
        pageUrl(code),
        detailPage({
          sfiDates: ['15/12/2026 - 10h00', '21/12/2026 - 10h00'],
          photos: [],
          edital: null,
          matricula: null,
        }),
      );
    }
  });

  const clockEntries = async () => entriesOf(h, '0001', 'CLOCK');

  it('records the round change and the price drop on the run that first sees the 2nd round, before the update completes', async () => {
    // Before the signal reaches its subscribers, the entries are already there (BR-004-23).
    const seenAtSignal: number[] = [];
    h.bus.subscribe(async () => {
      seenAtSignal.push(await h.kit.changeModel.countDocuments({ source: 'CLOCK' }));
    });
    const monday = await runDay(h, MON, list(MON));
    expect(await clockEntries()).toEqual([]); // the 1st round is running
    expect((await stored(h, '0001'))?.currentRoundLabel).toBe('1º Leilão');
    expect(seenAtSignal).toEqual([0]);

    // Tuesday's list is published at 11h00: the 1st round ended at 10h00.
    const tuesday = await runDay(h, TUE, list(TUE), { minutes: HH(11) });

    const entries = await clockEntries();
    expect(
      entries.map((entry) => [
        entry.type,
        entry.relevant,
        entry.field,
        entry.oldValue,
        entry.newValue,
      ]),
    ).toEqual([
      // By field: currentMinimumPrice, then currentRound.
      ['PRICE_DROPPED', true, 'currentMinimumPrice', '192622.00', '170201.84'],
      ['MODALITY_OR_ROUND_CHANGED', true, 'currentRound', '1º Leilão', '2º Leilão'],
    ]);
    expect(entries.every((entry) => entry.source === 'CLOCK')).toBe(true);
    expect(entries.every((entry) => entry.importRunId.toString() === tuesday?.id)).toBe(true);
    expect(entries.every((entry) => entry.importRunId.toString() !== monday?.id)).toBe(true);
    expect((await stored(h, '0001'))?.currentRoundLabel).toBe('2º Leilão');
    // The entries were there when the daily update was signalled.
    expect(seenAtSignal).toEqual([0, 2]);
    expect(h.events).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.createdAt.getTime()).toBeLessThanOrEqual(
        tuesday?.updateCompletedAt?.getTime() ?? 0,
      );
    }
    // The other properties' rounds have not ended: nothing was recorded for them.
    expect(await h.kit.changeModel.countDocuments({ source: 'CLOCK' })).toBe(2);
  });

  it('adds nothing when the clock step is repeated, or the next run finds the same round', async () => {
    await runDay(h, MON, list(MON));
    const tuesday = await runDay(h, TUE, list(TUE), { minutes: HH(11) });
    expect(await clockEntries()).toHaveLength(2);

    // The same run again (a retried completion step): nothing new.
    const again = await h.roundClock().record({
      importRunId: tuesday?.id ?? '',
      assertHeld: () => Promise.resolve(),
    });
    expect(again).toBe(0);
    // The next day's run: still the 2nd round.
    await runDay(h, WED, list(WED));
    expect(await clockEntries()).toHaveLength(2);
    expect(await h.kit.changeModel.countDocuments({ source: 'CLOCK' })).toBe(2);
  });

  it('is resumable: a step that died after the entries and before moving the round records the same entries once', async () => {
    await runDay(h, MON, list(MON));
    const tuesday = await runDay(h, TUE, list(TUE), { minutes: HH(11) });
    // Put the property back as the crash left it: entries written, the recorded round not moved.
    await h.kit.auctionModel.updateOne(
      { code: '0001' },
      { $set: { currentRoundLabel: '1º Leilão' } },
    );

    await h
      .roundClock()
      .record({ importRunId: tuesday?.id ?? '', assertHeld: () => Promise.resolve() });

    expect(await clockEntries()).toHaveLength(2); // the unique key: the same two, not four
    expect((await stored(h, '0001'))?.currentRoundLabel).toBe('2º Leilão');
  });

  it('records the label silently, with no entry, when the property is inactive after its last round', async () => {
    await runDay(h, MON, list(MON));
    await runDay(h, TUE, list(TUE), { minutes: HH(11) });

    // Monday the 30th at 11h00: the 2nd round ended at 10h00. No round is current any more.
    await runDay(h, NEXT_MON, list(NEXT_MON), { minutes: HH(11) });

    expect((await stored(h, '0001'))?.currentRoundLabel).toBeNull();
    expect(await clockEntries()).toHaveLength(2); // only Tuesday's two
  });

  it('records no entry for a property whose round was never recorded: a first look is not a change', async () => {
    // A property collected before this existed: rounds known, no recorded round.
    await runDay(h, MON, list(MON));
    await h.kit.auctionModel.updateOne({ code: '0001' }, { $unset: { currentRoundLabel: '' } });

    await runDay(h, TUE, list(TUE), { minutes: HH(11) });

    expect(await clockEntries()).toEqual([]);
    expect((await stored(h, '0001'))?.currentRoundLabel).toBe('2º Leilão');
  });

  it('leaves out a property that is no longer available', async () => {
    await runDay(h, MON, list(MON));
    // 0001 leaves Tuesday's list (4 of 5 rows).
    await runDay(h, TUE, csvList(TUE, five().slice(1)), { minutes: HH(11) });

    expect(await clockEntries()).toEqual([]);
    expect((await stored(h, '0001'))?.currentRoundLabel).toBe('1º Leilão');
  });

  it('completes the daily update even if the clock step fails, and says so by code', async () => {
    const logged = spyOnLogger();
    const failing = new RoundClockService(h.properties, h.kit.changes, h.clock);
    vi.spyOn(failing, 'record').mockRejectedValue(new Error('boom: owner name'));
    h.caixa.serveList(list(MON));
    h.clock.set(brasiliaInstant(MON, HH(6)));
    const env = {};

    await h.sleeper.drive(
      h.orchestrator(env, { enrichment: h.realPass(env), roundClock: failing }).tick(),
    );

    const run = await h.kit.runs.findByDate(MON);
    expect(run?.updateCompletedAt).not.toBeNull();
    expect(h.events).toHaveLength(1);
    expect(logged.loggedText()).toContain('The round clock check failed');
    expect(logged.loggedText()).not.toContain('owner name'); // SC-15: the code, never the message
  });
});
