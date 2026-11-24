// SPEC-004 BR-004-11, BR-004-15, BR-004-22, BR-004-25, BR-004-26, BR-004-30, SC-13, SC-18 (part 4):
// what a collected detail page writes to a property, the change entries it records, and the copies
// of its photos, edital and matrícula with their versions. Real orchestrator, pass and MongoDB;
// Caixa, the clock, the mail and R2 are fakes (TS-06, TS-07). Pages and files are invented
// (TS-27): no owner, no CPF, no matrícula text.
//
// Calendar (Brasília, no DST): 2026-11-23 Monday ... Friday 2026-11-27; the rounds below end in
// December, so every property stays active throughout.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CaixaUnreachableError } from '../../src/auctions/caixa/caixa-access.js';
import { toAuction } from '../../src/auctions/auction.mapper.js';
import { brasiliaInstant } from '../../src/auctions/domain/import-schedule.js';
import { AuctionDocumentsService } from '../../src/auctions/documents/auction-documents.service.js';
import { DetailApplier } from '../../src/auctions/enrichment/detail-applier.js';
import type { AuctionsService } from '../../src/auctions/auctions.service.js';
import type { StorageService } from '../../src/storage/storage.service.js';
import { DomainError } from '../../src/common/errors/domain-error.js';
import { jpegVariant, pdfVariant } from '../support/file-bytes.js';
import { detailPage, type PageSpec } from '../support/detail-pages.js';
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
import { createImportHarness, type ImportHarness } from '../support/import-harness.js';
import { spyOnLogger } from '../support/logger-spy.js';
import { useTestDatabase } from '../support/test-database.js';

const MON = '2026-11-23';
const TUE = '2026-11-24';
const WED = '2026-11-25';
const THU = '2026-11-26';
const SITE = 'https://venda-imoveis.caixa.gov.br';
const SFI_DATES: [string, string] = ['15/12/2026 - 10h00', '21/12/2026 - 10h00'];
const DAILY = { ENRICHMENT_MAX_STALENESS_DAYS: '1' }; // every property is due the next day

const sha16 = (body: Buffer) => createHash('sha256').update(body).digest('hex').slice(0, 16);

describe('what a collection writes, records and copies (integration)', () => {
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
    h.clock.set(brasiliaInstant(MON, HH(5)));
    // The other four properties of the list answer a bare page: no photos, no documents.
    for (const code of ['0002', '0003', '0004', '0005']) {
      h.caixa.serveDetailPage(
        pageUrl(code),
        detailPage({ sfiDates: SFI_DATES, photos: [], edital: null, matricula: null }),
      );
    }
  });

  const serve = (code: string, spec: PageSpec) =>
    h.caixa.serveDetailPage(pageUrl(code), detailPage(spec));
  const serveFile = (path: string, body: Buffer, contentType: string) =>
    h.caixa.serveFile(`${SITE}${path}`, { body, contentType });
  /** Five properties, so one may leave the list without the list being refused as truncated. */
  const five = (modality: string = MODALITY.sfi) => properties(5, modality);

  const sfiPage = (overrides: PageSpec = {}): PageSpec => ({
    sfiDates: SFI_DATES,
    firstPrice: '192.622,00',
    secondPrice: '170.201,84',
    methods: ['own', 'fgts'],
    occupancy: 'Desocupado',
    type: 'Sobrado',
    photos: ['/fotos/F1.jpg'],
    edital: null,
    matricula: null,
    ...overrides,
  });

  // --- what a page writes (BR-004-11, BR-004-15) -----------------------------------------------------

  describe('the data of a page', () => {
    it('writes rounds with their prices and dates, the payment methods, occupancy and type, and mirrors the dates into the phase', async () => {
      serve('0001', sfiPage());
      serveFile('/fotos/F1.jpg', jpegVariant('a'), 'image/jpeg');

      await runDay(h, MON, csvList(MON, five()));

      const property = await stored(h, '0001');
      expect(
        property?.rounds?.map((round) => [round.label, round.date, round.minimumPrice?.toString()]),
      ).toEqual([
        ['1º Leilão', new Date('2026-12-15T13:00:00.000Z'), '192622'], // 10h00 in Brasília
        ['2º Leilão', new Date('2026-12-21T13:00:00.000Z'), '170201.84'],
      ]);
      expect(property).toMatchObject({
        paymentMethods: ['OWN_RESOURCES', 'FGTS'],
        occupancy: 'UNOCCUPIED',
        propertyType: 'Sobrado', // the page's value wins over the list's "Casa" fallback
        description: 'Imóvel sintético para teste.',
        currentRoundLabel: '1º Leilão',
        fulfilled: true,
        detailsFailures: 0,
        detailsCollectedAt: brasiliaInstant(MON, HH(6)),
      });
      // The public API still reads the phase (phases[].phaseDates, paymentMethods).
      expect(property?.currentPhase).toMatchObject({
        phaseDates: [new Date('2026-12-15T13:00:00.000Z'), new Date('2026-12-21T13:00:00.000Z')],
        paymentMethods: ['OWN_RESOURCES', 'FGTS'],
      });
      expect(property?.phases?.[0]).toMatchObject({ paymentMethods: ['OWN_RESOURCES', 'FGTS'] });
    });

    it('leaves unknown what the page does not say: no payment methods, no occupancy, no default', async () => {
      serve('0001', sfiPage({ methods: null, occupancy: undefined }));

      await runDay(h, MON, csvList(MON, five()));

      const property = await stored(h, '0001');
      expect(property?.paymentMethods).toBeUndefined();
      expect(property?.occupancy).toBeNull();
      expect(property?.fulfilled).toBe(true);
      // And so no change entry: the first collection of a property is not a change (BR-004-15).
      expect(await entriesOf(h, '0001', 'DETAILS')).toEqual([]);
    });

    it('keeps a known value when a later page does not state it', async () => {
      serve('0001', sfiPage());
      await runDay(h, MON, csvList(MON, five()), { env: DAILY });
      serve(
        '0001',
        sfiPage({
          methods: null,
          occupancy: undefined,
          sfiDates: undefined,
          firstPrice: undefined,
          singlePrice: '1,00',
        }),
      );

      await runDay(h, TUE, csvList(TUE, five()), { env: DAILY });

      const property = await stored(h, '0001');
      expect(property?.paymentMethods).toEqual(['OWN_RESOURCES', 'FGTS']);
      expect(property?.occupancy).toBe('UNOCCUPIED');
      expect(property?.rounds).toHaveLength(2); // a modality that needs dates and a page without: unchanged
      expect(await entriesOf(h, '0001', 'DETAILS')).toEqual([]);
    });
  });

  // --- what a page records (BR-004-25, BR-004-26) --------------------------------------------------------

  describe('the change entries of a collection', () => {
    it('records no STARTED_* entry for a property collected for the first time', async () => {
      serve('0001', sfiPage({ methods: ['own', 'fgts', 'financing'] }));

      await runDay(h, MON, csvList(MON, five()));

      const types = (await entriesOf(h, '0001')).map((entry) => entry.type);
      expect(types).toEqual(['NEW']); // the list's entry only
    });

    it('records STARTED_FINANCING on the run that collected the page that newly lists financing', async () => {
      serve('0001', sfiPage());
      const monday = await runDay(h, MON, csvList(MON, five()), { env: DAILY });
      serve('0001', sfiPage({ methods: ['own', 'fgts', 'financing'] }));

      const tuesday = await runDay(h, TUE, csvList(TUE, five()), { env: DAILY });

      const entries = await entriesOf(h, '0001', 'DETAILS');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'STARTED_FINANCING',
        relevant: true,
        field: 'paymentMethods',
        source: 'DETAILS',
        oldValue: 'FGTS,OWN_RESOURCES',
        newValue: 'FGTS,FINANCING,OWN_RESOURCES',
      });
      expect(entries[0]?.importRunId.toString()).toBe(tuesday?.id);
      expect(entries[0]?.importRunId.toString()).not.toBe(monday?.id);
      // The property moved: its search order follows what changed.
      expect((await stored(h, '0001'))?.updatedAt?.getTime()).toBeGreaterThanOrEqual(
        brasiliaInstant(TUE, HH(6)).getTime(),
      );
    });

    it('records STARTED_FGTS, then the stops as history only, then a moved date and a price drop', async () => {
      serve('0001', sfiPage({ methods: ['own'] }));
      await runDay(h, MON, csvList(MON, five()), { env: DAILY });

      serve('0001', sfiPage({ methods: ['own', 'fgts', 'financing'] }));
      await runDay(h, TUE, csvList(TUE, five()), { env: DAILY });
      serve('0001', sfiPage({ methods: ['own'] }));
      await runDay(h, WED, csvList(WED, five()), { env: DAILY });
      serve(
        '0001',
        sfiPage({
          methods: ['own'],
          sfiDates: ['15/12/2026 - 10h00', '22/12/2026 - 10h00'],
          firstPrice: '150.000,00',
        }),
      );
      await runDay(h, THU, csvList(THU, five()), { env: DAILY });

      const byRun = (await entriesOf(h, '0001', 'DETAILS')).map((entry) => [
        entry.importRunId.toString(),
        entry.type,
        entry.relevant,
      ]);
      const runs = await Promise.all([TUE, WED, THU].map((day) => h.kit.runs.findByDate(day)));
      const [tue, wed, thu] = runs.map((run) => run?.id);
      expect(byRun).toEqual(
        expect.arrayContaining([
          [tue, 'STARTED_FGTS', true],
          [tue, 'STARTED_FINANCING', true],
          [wed, 'STOPPED_FGTS', false],
          [wed, 'STOPPED_FINANCING', false],
          [thu, 'NEW_DATE', true],
          [thu, 'PRICE_DROPPED', true],
        ]),
      );
      expect(byRun).toHaveLength(6);
    });

    it('records the same collection once however many times it is applied (BR-004-07)', async () => {
      serve('0001', sfiPage({ methods: ['own'] }));
      await runDay(h, MON, csvList(MON, five()), { env: DAILY });
      serve('0001', sfiPage({ methods: ['own', 'financing'] }));
      const tuesday = await runDay(h, TUE, csvList(TUE, five()), { env: DAILY });
      const before = await entriesOf(h, '0001', 'DETAILS');
      expect(before).toHaveLength(1);

      // The same page applied again for the same run: a retry after a crash.
      const property = await h.properties.findForCollection('0001');
      if (property === null || tuesday === null) throw new Error('setup');
      await new DetailApplier(h.kit.changes, h.properties).apply({
        runId: tuesday.id,
        stored: { ...property, paymentMethods: ['OWN_RESOURCES'] as never },
        page: {
          description: null,
          propertyType: null,
          occupancy: null,
          phaseDates: [],
          prices: { first: null, second: null, single: null },
          paymentMethods: ['OWN_RESOURCES', 'FINANCING'] as never,
          expenseRules: null,
          photoUrls: [],
          matriculaUrl: null,
          editalUrl: null,
          editalPublishedAt: null,
        },
        copies: { newVersions: [], checked: [], entries: [], rejections: [] },
        now: h.clock.now(),
      });

      expect(await entriesOf(h, '0001', 'DETAILS')).toHaveLength(1);
    });

    it('records the change a returned property shows against what it had before it left', async () => {
      serve('0001', sfiPage({ methods: ['own'] }));
      await runDay(h, MON, csvList(MON, five()), { env: DAILY });
      // Tuesday 0001 is not on the list; Wednesday it is back, now accepting financing.
      await runDay(h, TUE, csvList(TUE, five().slice(1)), { env: DAILY });
      expect((await stored(h, '0001'))?.available).toBe(false);
      serve('0001', sfiPage({ methods: ['own', 'financing'] }));

      const wednesday = await runDay(h, WED, csvList(WED, five()), { env: DAILY });

      const entries = await entriesOf(h, '0001', 'DETAILS');
      expect(entries.map((entry) => [entry.type, entry.importRunId.toString()])).toEqual([
        ['STARTED_FINANCING', wednesday?.id],
      ]);
      expect((await entriesOf(h, '0001', 'LIST')).map((entry) => entry.type)).toEqual(
        expect.arrayContaining(['NEW', 'BECAME_UNAVAILABLE', 'RETURNED']),
      );
    });
  });

  // --- the copies (BR-004-22, BR-004-30, SC-13, SC-18) ---------------------------------------------------

  describe('the copies of photos, edital and matrícula', () => {
    const EDITAL_1 = pdfVariant('edital one');
    const EDITAL_2 = pdfVariant('edital two');
    const MATRICULA_1 = pdfVariant('registry one');
    const PHOTO_A = jpegVariant('a');
    const PHOTO_B = jpegVariant('b');

    function serveAll(spec: PageSpec = {}) {
      serve('0001', {
        ...sfiPage(),
        photos: ['/fotos/F1.jpg', '/fotos/F2.jpg'],
        edital: { path: '/editais/EL1.PDF', published: '23/01/2026 11:58:46' },
        matricula: '/editais/matricula/XX/1.pdf',
        ...spec,
      });
      serveFile('/fotos/F1.jpg', PHOTO_A, 'image/jpeg');
      serveFile('/fotos/F2.jpg', PHOTO_B, 'image/jpeg');
      serveFile('/editais/EL1.PDF', EDITAL_1, 'application/pdf');
      serveFile('/editais/matricula/XX/1.pdf', MATRICULA_1, 'application/pdf');
    }

    it('keeps the photos and the edital in the public bucket and the matrícula only in the private one', async () => {
      serveAll();

      await runDay(h, MON, csvList(MON, five()));

      const property = await stored(h, '0001');
      const photoKeys = [
        `auctions/0001/photos/${sha16(PHOTO_A)}.jpg`,
        `auctions/0001/photos/${sha16(PHOTO_B)}.jpg`,
      ];
      const editalKey = `auctions/0001/edital/${sha16(EDITAL_1)}.pdf`;
      const matriculaKey = `private/auctions/0001/matricula/${sha16(MATRICULA_1)}.pdf`;
      expect(property?.photos?.map((photo) => photo.storageKey)).toEqual(photoKeys);
      expect(property?.image?.storageKey).toBe(photoKeys[0]);
      expect(property?.edital?.storageKey).toBe(editalKey);
      expect(property?.edital?.publicUrl).toBe(`https://files.example.test/${editalKey}`);
      expect(property?.matricula?.storageKey).toBe(matriculaKey);
      // SC-18: the matrícula has no public URL and never touches the public bucket.
      expect(property?.matricula?.publicUrl).toBeUndefined();
      expect([...h.copyStorage.publicFiles.keys()].sort()).toEqual(
        [...photoKeys, editalKey].sort(),
      );
      expect([...h.copyStorage.privateFiles.keys()]).toEqual([matriculaKey]);
      // The versions, with the retrieval and publication dates (BR-004-30).
      expect(property?.documentVersions).toEqual([
        expect.objectContaining({
          kind: 'EDITAL',
          sourceUrl: `${SITE}/editais/EL1.PDF`,
          contentHash: createHash('sha256').update(EDITAL_1).digest('hex'),
          retrievedAt: brasiliaInstant(MON, HH(6)),
          publishedAt: new Date('2026-01-23T14:58:46.000Z'),
        }),
        expect.objectContaining({ kind: 'MATRICULA', publishedAt: null }),
      ]);
      // A first copy is a collection, not a replacement: no entry.
      expect(await entriesOf(h, '0001', 'DETAILS')).toEqual([]);
    });

    it('replaces the edital by a new version, keeps the old file stored, and records the replacement', async () => {
      serveAll();
      await runDay(h, MON, csvList(MON, five()), { env: DAILY });
      h.caixa.requests.length = 0;
      serveAll({ edital: { path: '/editais/EL2.PDF', published: '25/11/2026 09:00:00' } });
      serveFile('/editais/EL2.PDF', EDITAL_2, 'application/pdf');

      const tuesday = await runDay(h, TUE, csvList(TUE, five()), { env: DAILY });

      const property = await stored(h, '0001');
      expect(
        property?.documentVersions?.filter((version) => version.kind === 'EDITAL'),
      ).toHaveLength(2);
      // The page serves the NEW file ...
      expect(property?.edital?.storageKey).toBe(`auctions/0001/edital/${sha16(EDITAL_2)}.pdf`);
      expect(toAuction(property as never, h.clock.now()).editalUrl).toBe(
        `https://files.example.test/auctions/0001/edital/${sha16(EDITAL_2)}.pdf`,
      );
      // ... the previous one is still stored, with its retrieval date.
      expect(h.copyStorage.publicFiles.has(`auctions/0001/edital/${sha16(EDITAL_1)}.pdf`)).toBe(
        true,
      );
      expect(property?.documentVersions?.[0]).toMatchObject({
        kind: 'EDITAL',
        retrievedAt: brasiliaInstant(MON, HH(6)),
      });
      // A change entry, history only (BR-004-30: not one of the relevant types).
      const entries = await entriesOf(h, '0001', 'DETAILS');
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        type: 'OTHER_FIELD',
        relevant: false,
        field: 'edital',
        oldValue: sha16(EDITAL_1),
        newValue: sha16(EDITAL_2),
      });
      expect(entries[0]?.importRunId.toString()).toBe(tuesday?.id);
      // Only the edital was asked for again: the photos and the matrícula are already ours.
      expect(filesRequested(h)).toEqual(['/editais/EL2.PDF']);
    });

    it('does not ask for a file again while its copy is current: not the photos, not the documents', async () => {
      serveAll();
      await runDay(h, MON, csvList(MON, five()), { env: DAILY });
      h.caixa.requests.length = 0;

      await runDay(h, TUE, csvList(TUE, five()), { env: DAILY });

      expect(pagesRequested(h)).toEqual(['0001', '0002', '0003', '0004', '0005']); // all due (N = 1)
      expect(filesRequested(h)).toEqual([]);
    });

    it('compares a stored document with Caixa’s again after 30 days: the same content is no new version, another is', async () => {
      serveAll();
      await runDay(h, MON, csvList(MON, five()), { env: DAILY });
      // Make the copies 31 days old.
      await h.kit.auctionModel.updateOne(
        { code: '0001' },
        { $set: { 'documentVersions.$[].checkedAt': new Date('2026-10-20T12:00:00Z') } },
      );
      h.caixa.requests.length = 0;

      // Same content behind the same address and date: compared, not stored again.
      await runDay(h, TUE, csvList(TUE, five()), { env: DAILY });
      expect(filesRequested(h).sort()).toEqual(['/editais/EL1.PDF', '/editais/matricula/XX/1.pdf']);
      let property = await stored(h, '0001');
      expect(property?.documentVersions).toHaveLength(2);
      expect(
        property?.documentVersions?.every(
          (version) => version.checkedAt.getTime() >= brasiliaInstant(TUE, HH(6)).getTime(),
        ),
      ).toBe(true);

      // The edital's bytes change behind the same address (and date): found by the content hash.
      await h.kit.auctionModel.updateOne(
        { code: '0001' },
        { $set: { 'documentVersions.$[].checkedAt': new Date('2026-10-20T12:00:00Z') } },
      );
      serveFile('/editais/EL1.PDF', EDITAL_2, 'application/pdf');
      await runDay(h, WED, csvList(WED, five()), { env: DAILY });
      property = await stored(h, '0001');
      expect(
        property?.documentVersions?.filter((version) => version.kind === 'EDITAL'),
      ).toHaveLength(2);
      expect(property?.edital?.storageKey).toBe(`auctions/0001/edital/${sha16(EDITAL_2)}.pdf`);
      expect((await entriesOf(h, '0001', 'DETAILS')).map((entry) => entry.field)).toEqual([
        'edital',
      ]);
    });

    it('keeps at most the configured number of photos, in page order', async () => {
      serve(
        '0001',
        sfiPage({ photos: ['/fotos/F1.jpg', '/fotos/F2.jpg', '/fotos/F3.jpg', '/fotos/F4.jpg'] }),
      );
      for (const [n, body] of [
        ['1', PHOTO_A],
        ['2', PHOTO_B],
        ['3', jpegVariant('c')],
        ['4', jpegVariant('d')],
      ] as const) {
        serveFile(`/fotos/F${n}.jpg`, body, 'image/jpeg');
      }

      await runDay(h, MON, csvList(MON, five()), { env: { ENRICHMENT_MAX_PHOTOS: '2' } });

      expect(filesRequested(h)).toEqual(['/fotos/F1.jpg', '/fotos/F2.jpg']);
      expect((await stored(h, '0001'))?.photos).toHaveLength(2);
    });

    it('refuses what is not a valid photo or document, keeps the rest, and still collects the page', async () => {
      const logged = spyOnLogger();
      serve(
        '0001',
        sfiPage({
          photos: [
            '/fotos/ok.jpg',
            '/fotos/html.jpg',
            '/fotos/big.jpg',
            '/fotos/mismatch.jpg',
            '/fotos/gone.jpg',
            '/fotos/svg.jpg',
          ],
          edital: { path: '/editais/EL1.PDF' },
          matricula: '/editais/matricula/XX/1.pdf',
        }),
      );
      serveFile('/fotos/ok.jpg', PHOTO_A, 'image/jpeg');
      serveFile('/fotos/html.jpg', Buffer.from('<html>challenge</html>'), 'image/jpeg');
      serveFile('/fotos/big.jpg', Buffer.concat([PHOTO_A, Buffer.alloc(300)]), 'image/jpeg');
      serveFile('/fotos/mismatch.jpg', PHOTO_B, 'image/png');
      h.caixa.serveFile(`${SITE}/fotos/gone.jpg`, new CaixaUnreachableError('TIMEOUT'));
      serveFile('/fotos/svg.jpg', PHOTO_A, 'image/svg+xml');
      serveFile('/editais/EL1.PDF', Buffer.from('<html>not a pdf</html>'), 'application/pdf');
      serveFile(
        '/editais/matricula/XX/1.pdf',
        Buffer.concat([MATRICULA_1, Buffer.alloc(3000)]),
        'application/pdf',
      );

      const run = await runDay(h, MON, csvList(MON, five()), {
        env: { ENRICHMENT_MAX_PHOTO_BYTES: '200', ENRICHMENT_MAX_DOCUMENT_BYTES: '2000' },
      });

      expect(run?.collection).toMatchObject({ collected: 5, failed: 0, blocked: false });
      const property = await stored(h, '0001');
      expect(property?.photos?.map((photo) => photo.originalUrl)).toEqual([`${SITE}/fotos/ok.jpg`]);
      expect(property?.edital ?? null).toBeNull();
      expect(property?.matricula ?? null).toBeNull();
      expect(property?.documentVersions ?? []).toEqual([]);
      expect(h.copyStorage.privateFiles.size).toBe(0);
      expect(h.copyStorage.publicFiles.size).toBe(1);
      const text = logged.loggedText();
      for (const code of [
        'FILE_WRONG_TYPE',
        'FILE_TOO_LARGE',
        'FILE_TYPE_MISMATCH',
        'UNREACHABLE',
      ]) {
        expect(text).toContain(`outcome=${code}`);
      }
      expect(text).not.toContain('venda-imoveis'); // no URL in the log (SC-15)
    });

    it('does not copy the matrícula at all, and says so by code, when the private bucket is not configured (SC-18)', async () => {
      const logged = spyOnLogger();
      h.copyStorage.privateConfigured = false;
      serveAll();

      const run = await runDay(h, MON, csvList(MON, five()));

      expect(run?.collection).toMatchObject({ collected: 5, failed: 0 });
      // The matrícula was not even asked of Caixa, and no file went to the public bucket for it.
      expect(filesRequested(h)).not.toContain('/editais/matricula/XX/1.pdf');
      const property = await stored(h, '0001');
      expect(property?.matricula ?? null).toBeNull();
      expect(property?.documentVersions?.map((version) => version.kind)).toEqual(['EDITAL']);
      expect(h.copyStorage.allKeys().some((key) => key.includes('matricula'))).toBe(false);
      expect(logged.loggedText()).toContain('kind=MATRICULA outcome=PRIVATE_STORAGE_UNCONFIGURED');
      // The edital and the photos, public catalogue files, are copied as usual.
      expect(property?.edital?.storageKey).toBeDefined();
      expect(property?.photos).toHaveLength(2);
    });

    it('still collects the page when storing a file fails', async () => {
      h.copyStorage.failUploads = true;
      serveAll();

      const run = await runDay(h, MON, csvList(MON, five()));

      expect(run?.collection).toMatchObject({ collected: 5, failed: 0 });
      expect((await stored(h, '0001'))?.photos ?? []).toEqual([]);
      expect((await stored(h, '0001'))?.rounds).toHaveLength(2);
    });

    it('serves the photos, the edital and the matrícula after Caixa removes the listing (BR-004-22)', async () => {
      serveAll();
      await runDay(h, MON, csvList(MON, five()), { env: DAILY });
      // Tuesday's list no longer holds 0001: it is unavailable (4 of 5 rows).
      await runDay(h, TUE, csvList(TUE, five().slice(1)), { env: DAILY });

      const doc = await stored(h, '0001');
      expect(doc?.available).toBe(false);
      const auction = toAuction(doc as never, h.clock.now());
      expect(auction.available).toBe(false);
      expect(auction.photoUrls).toHaveLength(2);
      expect(auction.imageUrl).toBe(auction.photoUrls[0]);
      expect(auction.editalUrl).toBe(
        `https://files.example.test/auctions/0001/edital/${sha16(EDITAL_1)}.pdf`,
      );
      // The matrícula has no URL; it has a link issued per request, for 60 seconds.
      expect(auction.matriculaUrl).toBeNull();
      expect(auction.hasMatricula).toBe(true);
      const documents = new AuctionDocumentsService(
        {
          findDocumentByCode: (code: string) => h.kit.auctionModel.findOne({ code }),
        } as unknown as AuctionsService,
        h.copyStorage as unknown as StorageService,
      );
      await expect(documents.issueMatriculaLink('0001')).resolves.toEqual({
        url: expect.stringContaining('X-Amz-Expires=60'),
        expiresInSeconds: 60,
      });
      expect(h.copyStorage.linkRequests).toEqual([
        `private/auctions/0001/matricula/${sha16(MATRICULA_1)}.pdf`,
      ]);
      // A property with no matrícula copy, or no such property, has no link.
      await expect(documents.issueMatriculaLink('0002')).rejects.toBeInstanceOf(DomainError);
      await expect(documents.issueMatriculaLink('9999')).rejects.toBeInstanceOf(DomainError);
    });
  });
});
