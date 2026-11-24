// SPEC-004 BR-004-18..21, BR-004-23, BR-004-29 (part 4): the detail-page collection as the daily
// import runs it. The REAL orchestrator, run service, list applier, alert service and detail pass
// run on a real MongoDB (Testcontainers) under the production query setting (SC-10); only the
// edges are fakes (TS-06, TS-07): Caixa, the clock and the pauses (fake time), the mail, the R2
// copies. Caixa is never reached. Every expectation is worked out by hand from the rules.
//
// Calendar (Brasília, no DST): 2026-11-23 Monday ... 2026-11-27 Friday. Each day's list is
// generated that day and holds the same properties unless a case says otherwise.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { CaixaBlockedError, CaixaUnreachableError } from '../../src/auctions/caixa/caixa-access.js';
import { brasiliaInstant } from '../../src/auctions/domain/import-schedule.js';
import { LeaseLostError } from '../../src/auctions/import-runs/lease-lost.error.js';
import { readCaixaFixture } from '../support/fixtures.js';
import { createImportHarness, type ImportHarness } from '../support/import-harness.js';
import { captureAllLogOutput, spyOnLogger } from '../support/logger-spy.js';
import { useTestDatabase } from '../support/test-database.js';
import { detailPage } from '../support/detail-pages.js';
import {
  csvList,
  entriesOf,
  filesRequested,
  HH,
  MODALITY,
  pagesRequested,
  pageUrl,
  properties,
  runDay,
  stored,
} from '../support/detail-run.js';

const MON = '2026-11-23';
const TUE = '2026-11-24';
const WED = '2026-11-25';
const THU = '2026-11-26';
const GALLERY = ['/fotos/F1.jpg'];

/** An open-bidding page that stays active for weeks (the date is far ahead of every case). */
const ACTIVE_PAGE = detailPage({
  openBiddingDate: '30/12/2026 - 10h00',
  photos: GALLERY,
  edital: null,
  matricula: null,
});

describe('the detail collection (integration)', () => {
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
    h.copyStorage.publicFiles.clear();
    h.copyStorage.privateFiles.clear();
    h.copyStorage.publicConfigured = true;
    h.copyStorage.privateConfigured = true;
    h.copyStorage.failUploads = false;
    h.caixa.reset();
    h.sleeper.sleeps.length = 0;
    h.email.importAlertEmails.length = 0;
    h.events.length = 0;
    h.admins.splice(0, h.admins.length, 'admin.um@example.test', 'admin.dois@example.test');
    h.clock.set(brasiliaInstant(MON, HH(5)));
  });

  /** Every property of `codes` answers the same page, and every photo the same bytes. */
  function servePages(codes: readonly string[], page = ACTIVE_PAGE) {
    for (const code of codes) h.caixa.serveDetailPage(pageUrl(code), page);
    h.caixa.serveFile(`${'https://venda-imoveis.caixa.gov.br'}/fotos/F1.jpg`, {
      body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
      contentType: 'image/jpeg',
    });
  }

  const codes = (n: number) => properties(n).map((property) => property.code);

  // --- the order and the budget (BR-004-18, BR-004-19) ------------------------------------------

  describe('the queue and the daily budget', () => {
    it('collects new properties first when the budget is smaller than their number, the rest on later runs', async () => {
      const five = properties(5);
      servePages(codes(5));

      // Monday: five new properties, budget three: 0001..0003 (by number).
      const monday = await runDay(h, MON, csvList(MON, five), {
        env: { ENRICHMENT_DAILY_PAGES: '3' },
      });
      expect(monday).toMatchObject({
        outcome: 'SUCCESS',
        collection: { collected: 3, failed: 0, blocked: false, pages: 3 },
      });
      expect(pagesRequested(h)).toEqual(['0001', '0002', '0003']);
      expect((await stored(h, '0003'))?.fulfilled).toBe(true);
      expect((await stored(h, '0004'))?.detailsCollectedAt ?? null).toBeNull();

      // Tuesday: 0002's list row changes (its price), 0004 and 0005 are still new. New first
      // (0004, 0005), then the changed one (0002); 0001 and 0003 were collected yesterday.
      h.caixa.requests.length = 0;
      const tuesdayRows = five.map((row) =>
        row.code === '0002' ? { ...row, price: '90.000,00' } : row,
      );
      const tuesday = await runDay(h, TUE, csvList(TUE, tuesdayRows), {
        env: { ENRICHMENT_DAILY_PAGES: '3' },
      });
      expect(pagesRequested(h)).toEqual(['0004', '0005', '0002']);
      expect(tuesday?.collection).toEqual({ collected: 3, failed: 0, blocked: false, pages: 3 });

      // Wednesday: everything is collected and fresh (N = 7): nothing to ask.
      h.caixa.requests.length = 0;
      const wednesday = await runDay(h, WED, csvList(WED, tuesdayRows), {
        env: { ENRICHMENT_DAILY_PAGES: '3' },
      });
      expect(pagesRequested(h)).toEqual([]);
      expect(wednesday).toMatchObject({
        outcome: 'SUCCESS',
        collection: { collected: 0, failed: 0, blocked: false, pages: 0 },
      });
    });

    it('puts a returned property before a changed one, and both before a refresh', async () => {
      const rows = properties(5);
      servePages(codes(5));
      await runDay(h, MON, csvList(MON, rows), { env: { ENRICHMENT_MAX_STALENESS_DAYS: '2' } });
      h.caixa.requests.length = 0;

      // Tuesday: 0005 leaves the list (unavailable; 4 of 5 rows is a valid list). Wednesday: it is
      // back (returned), 0002's price changed, and 0001, 0003, 0004 are 2 days old (due, N = 2).
      await runDay(h, TUE, csvList(TUE, rows.slice(0, 4)), {
        env: { ENRICHMENT_MAX_STALENESS_DAYS: '2' },
      });
      h.caixa.requests.length = 0;
      const wednesdayRows = rows.map((row) =>
        row.code === '0002' ? { ...row, price: '80.000,00' } : row,
      );
      await runDay(h, WED, csvList(WED, wednesdayRows), {
        env: { ENRICHMENT_MAX_STALENESS_DAYS: '2' },
      });

      // 0005 returned (details dropped), 0002 changed today, then the refreshes oldest first, by
      // number (0001, 0003 and 0004 were collected on Monday, 2 days ago).
      expect(pagesRequested(h)).toEqual(['0005', '0002', '0001', '0003', '0004']);
    });

    it('never asks for a property the list marks unavailable, however stale', async () => {
      const rows = properties(5);
      servePages(codes(5));
      await runDay(h, MON, csvList(MON, rows), { env: { ENRICHMENT_MAX_STALENESS_DAYS: '1' } });
      h.caixa.requests.length = 0;

      // Tuesday 0002 is gone from the list (4 of 5 rows: 80%, a valid list); everything else is
      // due (N = 1).
      await runDay(
        h,
        TUE,
        csvList(
          TUE,
          rows.filter((row) => row.code !== '0002'),
        ),
        {
          env: { ENRICHMENT_MAX_STALENESS_DAYS: '1' },
        },
      );

      expect(pagesRequested(h)).toEqual(['0001', '0003', '0004', '0005']);
      expect((await stored(h, '0002'))?.available).toBe(false);
    });

    it('never asks for a property that left the list before it was ever collected', async () => {
      servePages(codes(5));
      await runDay(h, MON, csvList(MON, properties(5)), { env: { ENRICHMENT_DAILY_PAGES: '1' } });
      expect(pagesRequested(h)).toEqual(['0001']);
      h.caixa.requests.length = 0;

      // 0003 is not on Tuesday's list (4 of 5 rows): unavailable, never asked for.
      await runDay(
        h,
        TUE,
        csvList(
          TUE,
          properties(5).filter((row) => row.code !== '0003'),
        ),
        {
          env: { ENRICHMENT_DAILY_PAGES: '10' },
        },
      );

      expect(pagesRequested(h)).toEqual(['0002', '0004', '0005']);
    });

    it('does not ask again, the same day, for a page already collected (a resumed pass)', async () => {
      servePages(codes(2));
      const run = await runDay(h, MON, csvList(MON, properties(2)));
      h.caixa.requests.length = 0;

      const pass = h.realPass();
      const result = await h.sleeper.drive(
        pass.run({
          importRunId: run?.id ?? '',
          brasiliaDate: MON,
          previous: { collected: 0, failed: 0, blocked: false, pages: 0 },
          assertHeld: () => Promise.resolve(),
          saveProgress: () => Promise.resolve(),
        }),
      );

      expect(pagesRequested(h)).toEqual([]);
      expect(result).toEqual({ collected: 0, failed: 0, blocked: false, pages: 0 });
    });

    it('keeps the daily budget across passes of the same day: a resumed pass takes only what is left', async () => {
      servePages(codes(6));
      // The day's list is applied by the orchestrator with no collection (a pass that did nothing).
      const run = await runDay(h, MON, csvList(MON, properties(6)), {
        env: { SCRAPER_ENABLED: 'false' },
      });
      expect(pagesRequested(h)).toEqual([]);
      const env = { ENRICHMENT_DAILY_PAGES: '4' };

      // First pass: the lease is lost after two pages.
      let saved = { collected: 0, failed: 0, blocked: false, pages: 0 };
      let held = 0;
      const first = h.realPass(env).run({
        importRunId: run?.id ?? '',
        brasiliaDate: MON,
        previous: saved,
        assertHeld: () => {
          // Two pages, each with its photo request: the 5th check is the 3rd page.
          if (++held > 4) return Promise.reject(new LeaseLostError('lost'));
          return Promise.resolve();
        },
        saveProgress: (progress) => {
          saved = progress;
          return Promise.resolve();
        },
      });
      await expect(h.sleeper.drive(first)).rejects.toBeInstanceOf(LeaseLostError);
      expect(saved).toMatchObject({ collected: 2, pages: 2 });
      expect(pagesRequested(h)).toEqual(['0001', '0002']); // the lease check before the third stopped it

      // Second pass: two pages are left of the four; the two collected are not asked again.
      h.caixa.requests.length = 0;
      const second = await h.sleeper.drive(
        h.realPass(env).run({
          importRunId: run?.id ?? '',
          brasiliaDate: MON,
          previous: saved,
          assertHeld: () => Promise.resolve(),
          saveProgress: (progress) => {
            saved = progress;
            return Promise.resolve();
          },
        }),
      );
      expect(pagesRequested(h)).toEqual(['0003', '0004']);
      expect(second).toEqual({ collected: 4, failed: 0, blocked: false, pages: 4 });

      // Third pass the same day: the budget is spent, no request at all.
      h.caixa.requests.length = 0;
      const third = await h.sleeper.drive(
        h.realPass(env).run({
          importRunId: run?.id ?? '',
          brasiliaDate: MON,
          previous: second,
          assertHeld: () => Promise.resolve(),
          saveProgress: () => Promise.resolve(),
        }),
      );
      expect(h.caixa.requests).toEqual([]);
      expect(third).toEqual(second);
    });

    it('collects nothing when SCRAPER_ENABLED is off, and the day still completes', async () => {
      servePages(codes(3));

      const run = await runDay(h, MON, csvList(MON, properties(3)), {
        env: { SCRAPER_ENABLED: 'false' },
      });

      expect(h.caixa.requests.filter((request) => request.kind !== 'list')).toEqual([]);
      expect(run).toMatchObject({
        outcome: 'SUCCESS',
        collection: { collected: 0, failed: 0, blocked: false, pages: 0 },
      });
      expect(run?.updateCompletedAt).not.toBeNull();
      expect(h.events).toHaveLength(1);
    });
  });

  // --- the rate (BR-004-18, SC-24) -----------------------------------------------------------------

  describe('the request rate, read from the collection log', () => {
    /** The lines of `collection.request`: kind, code, outcome and the offsets in ms. */
    function requestLines(text: string) {
      return [
        ...text.matchAll(
          /collection\.request kind=(\w+) code=(\w+) outcome=(\S+) startMs=(\d+) endMs=(\d+)/g,
        ),
      ].map(([, kind, code, outcome, start, end]) => ({
        kind: kind as string,
        code: code as string,
        outcome: outcome as string,
        start: Number(start),
        end: Number(end),
      }));
    }

    it.each([
      [1, 5000],
      [2, 1000],
      [3, 2500],
    ])(
      'never exceeds the configured concurrency (%i) or the pause (%i ms), whichever request it is',
      async (concurrency, pause) => {
        servePages(codes(8));
        // Every request takes 3 s of fake time, so requests overlap whenever the gate allows it.
        const pageOnce = h.caixa.fetchDetailPage.bind(h.caixa);
        const fileOnce = h.caixa.fetchFile.bind(h.caixa);
        vi.spyOn(h.caixa, 'fetchDetailPage').mockImplementation(async (url) => {
          await h.sleeper.sleep(3000);
          return pageOnce(url);
        });
        vi.spyOn(h.caixa, 'fetchFile').mockImplementation(async (url) => {
          await h.sleeper.sleep(3000);
          return fileOnce(url);
        });
        const capture = captureAllLogOutput();
        try {
          await runDay(h, MON, csvList(MON, properties(8)), {
            env: {
              ENRICHMENT_CONCURRENCY: String(concurrency),
              ENRICHMENT_MIN_PAUSE_MS: String(pause),
            },
          });
        } finally {
          capture.restore();
          vi.restoreAllMocks();
        }

        const lines = requestLines(capture.text());
        // One line per request, page or photo: 8 pages and 8 photos.
        expect(lines).toHaveLength(16);
        expect(lines.filter((line) => line.kind === 'page')).toHaveLength(8);
        expect(lines.every((line) => line.outcome === 'OK')).toBe(true);

        const starts = lines.map((line) => line.start).sort((a, b) => a - b);
        const gaps = starts.slice(1).map((start, index) => start - (starts[index] ?? 0));
        // At least the pause between starts, whichever worker made them...
        expect(Math.min(...gaps)).toBeGreaterThanOrEqual(pause);
        // ... and never more than `concurrency` in flight at an instant a request starts.
        const peak = Math.max(
          ...lines.map(
            ({ start }) =>
              lines.filter((other) => other.start <= start && other.end > start).length,
          ),
        );
        expect(peak).toBeLessThanOrEqual(concurrency);
        // The log leaks nothing: no URL, no address, no page text (SC-15, SC-24).
        expect(capture.text()).not.toMatch(/https?:\/\//);
        expect(capture.text()).not.toContain('Imóvel sintético');
      },
    );

    it('uses a fixed interval: the same gap every time, never random', async () => {
      servePages(codes(5));
      const capture = captureAllLogOutput();
      try {
        await runDay(h, MON, csvList(MON, properties(5)), {
          env: { ENRICHMENT_MIN_PAUSE_MS: '2000' },
        });
      } finally {
        capture.restore();
      }

      const starts = requestLines(capture.text()).map((line) => line.start);
      const gaps = starts.slice(1).map((start, index) => start - (starts[index] ?? 0));
      expect(new Set(gaps)).toEqual(new Set([2000]));
    });
  });

  // --- a block (BR-004-20, BR-004-29) -------------------------------------------------------------

  describe('a block, a challenge or a rate-limit answer', () => {
    it('stops the whole pass, records it, alerts the admins once and completes the day', async () => {
      servePages(codes(5));
      h.caixa.serveDetailPage(pageUrl('0003'), new CaixaBlockedError('HTTP_429'));

      const run = await runDay(h, MON, csvList(MON, properties(5)));

      // The third request got the refusal: nothing else was asked, today.
      expect(pagesRequested(h)).toEqual(['0001', '0002', '0003']);
      expect(run).toMatchObject({
        outcome: 'SUCCESS',
        collection: { collected: 2, failed: 0, blocked: true, pages: 3 },
      });
      // The day's update still completes (part 3): the list is applied, the pass ended.
      expect(run?.updateCompletedAt).not.toBeNull();
      expect(h.events).toHaveLength(1);
      // One alert per admin, for this run, once (BR-004-29).
      expect(h.email.importAlertEmails.map((sent) => sent.email).sort()).toEqual([
        'admin.dois@example.test',
        'admin.um@example.test',
      ]);
      expect(run?.alertedAt).not.toBeNull();
      // The property that was refused keeps no half-written data and is not marked failed.
      expect((await stored(h, '0003'))?.detailsCollectedAt ?? null).toBeNull();
      expect((await stored(h, '0003'))?.detailsFailures ?? 0).toBe(0);
    });

    it('sends no second email when ticks go on the same day, and resumes at the next run', async () => {
      servePages(codes(5));
      h.caixa.serveDetailPage(pageUrl('0003'), new CaixaBlockedError('HTTP_403'));
      await runDay(h, MON, csvList(MON, properties(5)));
      expect(h.email.importAlertEmails).toHaveLength(2);

      // More ticks the same day: nothing is asked of Caixa and nobody is told again.
      h.caixa.requests.length = 0;
      await runDay(h, MON, csvList(MON, properties(5)), { minutes: HH(9) });
      expect(h.caixa.requests.filter((request) => request.kind !== 'list')).toEqual([]);
      expect(h.email.importAlertEmails).toHaveLength(2);

      // Tuesday Caixa answers: the refused property comes first (new), then the rest.
      servePages(codes(5));
      h.caixa.requests.length = 0;
      const tuesday = await runDay(h, TUE, csvList(TUE, properties(5)));
      expect(pagesRequested(h)).toEqual(['0003', '0004', '0005']);
      expect(tuesday?.collection).toEqual({ collected: 3, failed: 0, blocked: false, pages: 3 });
      expect(h.email.importAlertEmails).toHaveLength(2); // no new alert: Tuesday was not blocked
    });

    it('treats the challenge page served with a 200 as a block, and never parses it', async () => {
      servePages(codes(3));
      h.caixa.serveDetailPage(pageUrl('0002'), readCaixaFixture('bot-protection.html'));

      const run = await runDay(h, MON, csvList(MON, properties(3)));

      expect(pagesRequested(h)).toEqual(['0001', '0002']);
      expect(run?.collection).toEqual({ collected: 1, failed: 0, blocked: true, pages: 2 });
      expect(h.email.importAlertEmails).toHaveLength(2);
      expect((await stored(h, '0002'))?.detailsCollectedAt ?? null).toBeNull();
    });

    it('stops the pass when a photo, a document or a redirect off the site is a block, writing nothing of that property', async () => {
      servePages(codes(3));
      h.caixa.serveFile(
        'https://venda-imoveis.caixa.gov.br/fotos/F1.jpg',
        new CaixaBlockedError('REDIRECT_OFF_SITE'),
      );

      const run = await runDay(h, MON, csvList(MON, properties(3)));

      expect(pagesRequested(h)).toEqual(['0001']);
      expect(run?.collection).toEqual({ collected: 0, failed: 0, blocked: true, pages: 1 });
      expect((await stored(h, '0001'))?.detailsCollectedAt ?? null).toBeNull();
      expect(await entriesOf(h, '0001', 'DETAILS')).toEqual([]);
    });

    it('asks nothing more on a pass resumed after a block the same day', async () => {
      servePages(codes(3));
      const run = await runDay(h, MON, csvList(MON, properties(3)), {
        env: { SCRAPER_ENABLED: 'false' },
      });
      h.caixa.requests.length = 0;
      const blocked = { collected: 1, failed: 0, blocked: true, pages: 2 };

      const result = await h.sleeper.drive(
        h.realPass().run({
          importRunId: run?.id ?? '',
          brasiliaDate: MON,
          previous: blocked,
          assertHeld: () => Promise.resolve(),
          saveProgress: () => Promise.resolve(),
        }),
      );

      expect(h.caixa.requests).toEqual([]);
      expect(result).toEqual(blocked);
    });

    it('does not alert for a day whose pass is not blocked, whatever failed', async () => {
      servePages(codes(3));
      h.caixa.serveDetailPage(pageUrl('0002'), new CaixaUnreachableError('TIMEOUT'));

      const run = await runDay(h, MON, csvList(MON, properties(3)));

      expect(run?.collection).toMatchObject({ failed: 1, blocked: false });
      expect(h.email.importAlertEmails).toEqual([]);
    });
  });

  // --- a failed page (BR-004-21) -----------------------------------------------------------------

  describe('a page that fails', () => {
    it('keeps the previous data, backs off, counts it failed and does not fail the run', async () => {
      const rows = properties(2);
      const fullPage = detailPage({
        openBiddingDate: '30/12/2026 - 10h00',
        methods: ['own', 'fgts'],
        photos: GALLERY,
        edital: null,
        matricula: null,
        description: 'Descrição de segunda.',
      });
      servePages(codes(2), fullPage);
      await runDay(h, MON, csvList(MON, rows));
      const before = await stored(h, '0002');
      expect(before?.paymentMethods).toEqual(['OWN_RESOURCES', 'FGTS']);

      // Tuesday 0002's row changes (so its page is due) and its page times out.
      h.caixa.serveDetailPage(pageUrl('0002'), new CaixaUnreachableError('TIMEOUT'));
      const tuesdayRows = rows.map((row) =>
        row.code === '0002' ? { ...row, price: '70.000,00' } : row,
      );
      const tuesday = await runDay(h, TUE, csvList(TUE, tuesdayRows));

      expect(tuesday).toMatchObject({
        outcome: 'SUCCESS',
        collection: { collected: 0, failed: 1, blocked: false, pages: 1 },
      });
      expect(tuesday?.updateCompletedAt).not.toBeNull();
      const after = await stored(h, '0002');
      // Everything the page gave is as it was...
      expect(after?.paymentMethods).toEqual(before?.paymentMethods);
      expect(after?.description).toBe(before?.description);
      expect(after?.rounds).toEqual(before?.rounds);
      expect(after?.photos).toEqual(before?.photos);
      expect(after?.detailsCollectedAt).toEqual(before?.detailsCollectedAt);
      // ... and the property waits: one failure, back at midnight Brasília, no DETAILS entries.
      expect(after?.detailsFailures).toBe(1);
      expect(after?.detailsRetryAfter).toEqual(brasiliaInstant(WED, 0));
      expect(await entriesOf(h, '0002', 'DETAILS')).toEqual([]);
    });

    it('retries it the next day and forgets the failure when the page answers', async () => {
      const rows = properties(1);
      servePages(codes(1));
      await runDay(h, MON, csvList(MON, rows));
      h.caixa.serveDetailPage(pageUrl('0001'), new CaixaUnreachableError('NETWORK'));
      const changed = [{ ...(rows[0] as (typeof rows)[number]), price: '70.000,00' }];
      await runDay(h, TUE, csvList(TUE, changed));
      expect((await stored(h, '0001'))?.detailsFailures).toBe(1);

      // Wednesday: the page answers; the property is retried although its row did not change today.
      servePages(
        codes(1),
        detailPage({
          openBiddingDate: '30/12/2026 - 10h00',
          photos: GALLERY,
          description: 'Nova descrição.',
        }),
      );
      h.caixa.requests.length = 0;
      const wednesday = await runDay(h, WED, csvList(WED, changed));

      expect(pagesRequested(h)).toEqual(['0001']);
      expect(wednesday?.collection).toMatchObject({ collected: 1, failed: 0 });
      const after = await stored(h, '0001');
      expect(after?.detailsFailures).toBe(0);
      expect(after?.detailsRetryAfter ?? null).toBeNull();
      expect(after?.description).toBe('Nova descrição.');
    });

    it('doubles the wait with each failure in a row', async () => {
      const rows = properties(1);
      h.caixa.serveDetailPage(pageUrl('0001'), new CaixaUnreachableError('TIMEOUT'));
      await runDay(h, MON, csvList(MON, rows)); // failure 1: retry Tuesday 00:00
      await runDay(h, TUE, csvList(TUE, rows)); // failure 2: retry Thursday 00:00 (2 days)
      expect((await stored(h, '0001'))?.detailsFailures).toBe(2);
      expect((await stored(h, '0001'))?.detailsRetryAfter).toEqual(brasiliaInstant(THU, 0));

      h.caixa.requests.length = 0;
      await runDay(h, WED, csvList(WED, rows)); // still waiting
      expect(pagesRequested(h)).toEqual([]);
      await runDay(h, THU, csvList(THU, rows)); // failure 3: retry Monday 00:00 (4 days)
      expect((await stored(h, '0001'))?.detailsFailures).toBe(3);
      expect((await stored(h, '0001'))?.detailsRetryAfter).toEqual(
        brasiliaInstant('2026-11-30', 0),
      );
    });

    it.each([
      ['an unreadable page', '<html><body><p>Erro inesperado</p></body></html>'],
      [
        'a page that says the property is unavailable',
        readCaixaFixture('unavailable-property.html'),
      ],
    ])(
      'counts %s as a failed fetch of that property, never as its availability',
      async (_, page) => {
        servePages(codes(2));
        h.caixa.serveDetailPage(pageUrl('0001'), page);

        const run = await runDay(h, MON, csvList(MON, properties(2)));

        expect(run?.collection).toEqual({ collected: 1, failed: 1, blocked: false, pages: 2 });
        const property = await stored(h, '0001');
        expect(property?.available).toBe(true); // only the list decides (BR-004-08)
        expect(property?.detailsFailures).toBe(1);
        expect(await entriesOf(h, '0001', 'LIST')).toMatchObject([{ type: 'NEW' }]); // no BECAME_UNAVAILABLE
      },
    );

    it('stops the pass after the configured number of failures in a row: not a block, no alert', async () => {
      servePages(codes(6));
      for (const code of codes(6)) {
        h.caixa.serveDetailPage(pageUrl(code), new CaixaUnreachableError('TIMEOUT'));
      }

      const run = await runDay(h, MON, csvList(MON, properties(6)), {
        env: { ENRICHMENT_MAX_CONSECUTIVE_FAILURES: '3' },
      });

      expect(pagesRequested(h)).toEqual(['0001', '0002', '0003']);
      expect(run).toMatchObject({
        outcome: 'SUCCESS',
        collection: { collected: 0, failed: 3, blocked: false, pages: 3 },
      });
      expect(run?.updateCompletedAt).not.toBeNull();
      expect(h.email.importAlertEmails).toEqual([]);
    });

    it('does not stop the pass when successes break the run of failures', async () => {
      servePages(codes(6));
      for (const code of ['0001', '0002', '0004', '0005']) {
        h.caixa.serveDetailPage(pageUrl(code), new CaixaUnreachableError('TIMEOUT'));
      }

      const run = await runDay(h, MON, csvList(MON, properties(6)), {
        env: { ENRICHMENT_MAX_CONSECUTIVE_FAILURES: '3' },
      });

      // fail, fail, ok, fail, fail, ok: never three in a row.
      expect(pagesRequested(h)).toHaveLength(6);
      expect(run?.collection).toEqual({ collected: 2, failed: 4, blocked: false, pages: 6 });
    });
  });

  // --- the staleness bound (BR-004-19, DL-004-09) -------------------------------------------------

  describe('the rolling refresh', () => {
    it('keeps every active property within N days over 18 days when the budget covers catalogue / N', async () => {
      const N = 7;
      const rows = properties(14);
      servePages(codes(14));
      const env = { ENRICHMENT_DAILY_PAGES: '2', ENRICHMENT_MAX_STALENESS_DAYS: String(N) };
      const worst: number[] = [];

      for (let day = 0; day < 18; day++) {
        const date = new Date(Date.UTC(2026, 10, 23 + day, 12));
        const key = date.toISOString().slice(0, 10);
        h.caixa.requests.length = 0;
        const run = await runDay(h, key, csvList(key, rows), { env });
        expect(run?.collection.pages).toBeLessThanOrEqual(2); // the budget, every day
        expect(pagesRequested(h).length).toBeLessThanOrEqual(2);

        if (day >= 6) {
          // From the 7th day on, every property has been collected once (14 / 2 = 7 days).
          const all = await h.kit.auctionModel.find({}).lean().exec();
          const ages = all.map((property) => {
            const collected = property.detailsCollectedAt;
            if (!collected) return Number.POSITIVE_INFINITY;
            const collectedDay = new Date(collected.getTime() - 3 * 3600_000)
              .toISOString()
              .slice(0, 10);
            return Math.round((Date.parse(key) - Date.parse(collectedDay)) / 86_400_000);
          });
          worst.push(Math.max(...ages));
        }
      }

      expect(worst).toHaveLength(12);
      expect(Math.max(...worst)).toBeLessThanOrEqual(N);
    });
  });

  // --- the lease (part 3's guard, BR-004-07) ---------------------------------------------------------

  describe('a lease lost in the middle of the pass', () => {
    it('stops quietly before the next request, and the next tick resumes where it was', async () => {
      servePages(codes(5));
      const log = spyOnLogger();
      // After the second page is served, another worker takes the run over.
      const servePage = h.caixa.fetchDetailPage.bind(h.caixa);
      let pagesServed = 0;
      vi.spyOn(h.caixa, 'fetchDetailPage').mockImplementation(async (url) => {
        const html = await servePage(url);
        if (++pagesServed === 2) {
          await h.kit.runModel.updateOne(
            { brasiliaDate: MON },
            { $set: { leaseOwner: 'another-worker', leaseExpiresAt: new Date('2099-01-01') } },
          );
        }
        return html;
      });

      const interrupted = await runDay(h, MON, csvList(MON, properties(5)));
      vi.restoreAllMocks();

      // Quiet: no request after the lease was lost, nothing completed, no fault reported.
      expect(pagesRequested(h)).toEqual(['0001', '0002']);
      expect(interrupted?.updateCompletedAt).toBeNull();
      expect(interrupted?.collection).toMatchObject({ collected: 1, pages: 1 }); // what was saved
      expect(h.events).toEqual([]);
      expect(log.loggedText()).not.toContain('The collection pass failed');
      expect(log.loggedText()).toContain('lease of the run');

      // The other worker is gone; its lease ran out. The next tick resumes: 0001 is not asked
      // again, 0002 (whose page was fetched but lost) is, then the rest.
      await h.kit.runModel.updateOne(
        { brasiliaDate: MON },
        { $set: { leaseOwner: null, leaseExpiresAt: null } },
      );
      h.caixa.requests.length = 0;
      servePages(codes(5));
      const resumed = await runDay(h, MON, csvList(MON, properties(5)), { minutes: HH(6, 5) });

      expect(pagesRequested(h)).toEqual(['0002', '0003', '0004', '0005']);
      expect(resumed?.collection).toEqual({ collected: 5, failed: 0, blocked: false, pages: 5 });
      expect(resumed?.updateCompletedAt).not.toBeNull();
      expect(h.events).toHaveLength(1);
      expect(filesRequested(h)).toHaveLength(4);
    });
  });

  // --- the files cannot be stored: the property is still collected ---------------------------------

  describe('storage', () => {
    it('still collects the page when R2 is not configured: no copy, the data is stored', async () => {
      servePages(codes(2));
      h.copyStorage.publicConfigured = false;

      const run = await runDay(h, MON, csvList(MON, properties(2)));

      expect(run?.collection).toMatchObject({ collected: 2, failed: 0 });
      expect(filesRequested(h)).toEqual([]); // nothing asked of Caixa that could not be kept
      expect((await stored(h, '0001'))?.photos ?? []).toEqual([]);
      expect((await stored(h, '0001'))?.description).toBe('Imóvel sintético para teste.');
    });
  });

  it('lets the listing and the sleeper be used with the SFI and direct fixtures too', async () => {
    // The real pages of the fixtures (dates in the past): the rounds are written, the property
    // reads inactive, nothing breaks. Direct online sales have one open-ended round.
    h.caixa.serveDetailPage(pageUrl('0001'), readCaixaFixture('sfi-auction.html'));
    h.caixa.serveDetailPage(pageUrl('0002'), readCaixaFixture('direct-online-sales.html'));
    h.caixa.serveFile(
      'https://venda-imoveis.caixa.gov.br/fotos/F878770800366821.jpg',
      new CaixaUnreachableError('NETWORK'),
    );

    const run = await runDay(
      h,
      MON,
      csvList(MON, [
        { code: '0001', modality: MODALITY.sfi },
        { code: '0002', modality: MODALITY.direct },
      ]),
    );

    expect(run?.collection).toMatchObject({ collected: 2, failed: 0, blocked: false });
    const sfi = await stored(h, '0001');
    expect(sfi?.rounds?.map((round) => round.label)).toEqual(['1º Leilão', '2º Leilão']);
    expect(sfi?.rounds?.map((round) => round.date)).toEqual([
      new Date('2026-03-03T13:00:00.000Z'),
      new Date('2026-03-09T13:00:00.000Z'),
    ]);
    expect(sfi?.rounds?.map((round) => round.minimumPrice?.toString())).toEqual([
      '192622',
      '170201.84',
    ]);
    const direct = await stored(h, '0002');
    expect(direct?.rounds).toEqual([
      expect.objectContaining({ label: 'Venda Direta', date: null }),
    ]);
  });
});
