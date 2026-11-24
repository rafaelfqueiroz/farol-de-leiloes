// SPEC-004 BR-004-01..04, BR-004-07, BR-004-10, BR-004-20, BR-004-23, BR-004-24, BR-004-29,
// BR-004-31: the daily import as a state machine, end to end below the network. The REAL
// orchestrator, run service, list applier, alert service and calendar run on a real MongoDB
// (Testcontainers) under the production query setting (SC-10); only the edges are fakes (TS-06,
// TS-07): Caixa, the clock, the mail, the admins' addresses, the enrichment pass and the health
// record. Caixa is never reached. Every expectation is worked out by hand from the rules.
//
// Calendar of the scenarios (Brasília, no DST): 2026-11-20 Friday, 21 Saturday, 22 Sunday,
// 23 Monday; 2026-12-24 Thursday, 12-25 Friday (a holiday only when configured), 12-28 Monday.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { CaixaBlockedError, CaixaUnreachableError } from '../../src/auctions/caixa/caixa-access.js';
import { brasiliaInstant } from '../../src/auctions/domain/import-schedule.js';
import {
  ListApplier,
  SweepAbortedError,
} from '../../src/auctions/importer/list-applier.service.js';
import { ImportRunRepository } from '../../src/auctions/import-runs/import-run.repository.js';
import { ListApplierRepository } from '../../src/auctions/importer/list-applier.repository.js';
import { RUN_LEASE_MS } from '../../src/auctions/import-runs/import-run.service.js';
import { spyOnLogger } from '../support/logger-spy.js';
import { readCaixaFixture } from '../support/fixtures.js';
import { createImportHarness, type ImportHarness } from '../support/import-harness.js';
import { useTestDatabase } from '../support/test-database.js';

const FRIDAY = '2026-11-20';
const SATURDAY = '2026-11-21';
const SUNDAY = '2026-11-22';
const MONDAY = '2026-11-23';
const TUESDAY = '2026-11-24';

const HH = (hours: number, minutes = 0) => hours * 60 + minutes;

/** A list generated on `day` (dd/mm/yyyy) with the given rows [code, modality, price]. */
function list(day: string, rows: [string, string, string][]) {
  return (
    ` Lista de Imóveis da Caixa;;Data de geração:;${day};;;;;;;\n` +
    ' N° do imóvel;UF;Cidade;Bairro;Endereço;Preço;Valor de avaliação;Desconto;Descrição;Modalidade de venda;Link de acesso\n\n' +
    rows
      .map(
        ([code, modality, price]) =>
          ` ${code} ;SP ;CAMPINAS ;CENTRO ; RUA A, N. 1 ;${price};200.000,00;50.00;Casa, 60 m2;${modality};` +
          `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=${code}\n`,
      )
      .join('')
  );
}

const TEN = Array.from({ length: 10 }, (_, i): [string, string, string] => [
  `${1000 + i}`,
  'Venda Online',
  '100.000,00',
]);
const FRIDAY_LIST = list('20/11/2026', TEN);
const MONDAY_LIST = list('23/11/2026', TEN);

describe('the import state machine (integration)', () => {
  const db = useTestDatabase();
  let h: ImportHarness;

  beforeAll(async () => {
    h = await createImportHarness(db.uri, brasiliaInstant(FRIDAY, HH(5)));
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
    h.storage.configured = true;
    h.storage.failReads = false;
    h.auctions.invalidateNeighborhoodsCache.mockReset().mockResolvedValue(undefined);
    h.caixa.requests.length = 0;
    h.caixa.serveList(FRIDAY_LIST);
    h.email.importAlertEmails.length = 0;
    h.email.failAll = false;
    h.email.failFor.clear();
    h.events.length = 0;
    h.enrichment.calls.length = 0;
    h.enrichment.result = { collected: 0, failed: 0, blocked: false, pages: 0 };
    h.enrichment.failWith = null;
    h.enrichment.hook = null;
    h.health.recordExecution.mockClear();
    h.health.recordFailure.mockClear();
    h.admins.splice(0, h.admins.length, 'admin.um@example.test', 'admin.dois@example.test');
    setClock(FRIDAY, HH(5));
  });

  // --- helpers -----------------------------------------------------------------------------

  const setClock = (day: string, minutes: number) => h.clock.set(brasiliaInstant(day, minutes));
  const listRequests = () => h.caixa.requests.filter((request) => request.kind === 'list').length;
  const runOf = (day: string) => h.kit.runs.findByDate(day);

  /** Ticks every five minutes of the day from `from` to `to`, both included (the cron's rhythm). */
  async function tickThrough(
    orchestrator: ReturnType<ImportHarness['orchestrator']>,
    day: string,
    from: number,
    to: number,
  ) {
    for (let minutes = from; minutes <= to; minutes += 5) {
      setClock(day, minutes);
      await orchestrator.tick();
    }
  }

  /** Friday's list applied: the baseline every later day is judged against. */
  async function fridayApplied(orchestrator = h.orchestrator()) {
    h.caixa.serveList(FRIDAY_LIST);
    setClock(FRIDAY, HH(6));
    await orchestrator.tick();
    expect(await runOf(FRIDAY)).toMatchObject({ outcome: 'SUCCESS' });
    h.caixa.requests.length = 0;
    h.events.length = 0;
    h.enrichment.calls.length = 0;
    h.health.recordExecution.mockClear();
  }

  async function snapshot() {
    return {
      auctions: await h.kit.auctionModel.collection.find({}).sort({ code: 1 }).toArray(),
      changes: await h.kit.changeModel.countDocuments(),
    };
  }

  /** `ticks` ticks, five minutes apart, from `from` on `day` (the cron's rhythm). */
  async function tickN(
    orchestrator: ReturnType<ImportHarness['orchestrator']>,
    day: string,
    from: number,
    ticks: number,
  ) {
    for (let i = 0; i < ticks; i++) {
      setClock(day, from + i * 5);
      await orchestrator.tick();
    }
  }

  /** Monday 06:00: the worker downloads `csv`, starts applying it and is killed (never returns). */
  async function killedMidApply(csv: string) {
    h.caixa.serveList(csv);
    setClock(MONDAY, HH(6));
    void h.orchestrator({}, { applier: applierThatStalls(0) }).tick();
    await waitFor(async () => (await runOf(MONDAY))?.progress.applying === true);
  }

  /** A real applier whose repository writes `chunks` chunks of the list and then never answers. */
  function applierThatStalls(chunks: number): ListApplier {
    class Stalling extends ListApplierRepository {
      private written = 0;
      override applyChunk(...args: Parameters<ListApplierRepository['applyChunk']>) {
        if (this.written++ >= chunks) return new Promise<void>(() => undefined);
        return super.applyChunk(...args);
      }
    }
    return new ListApplier(new Stalling(h.kit.auctionModel), h.kit.changes, h.clock);
  }

  // --- (i) and (ii): a successful day ---------------------------------------------------------

  describe('a day with a new valid list (BR-004-01, BR-004-06, BR-004-23, BR-004-24)', () => {
    it('applies it, collects, completes the update once, emits one event and moves "last updated"', async () => {
      const orchestrator = h.orchestrator();
      h.enrichment.result = { collected: 7, failed: 1, blocked: false, pages: 0 };
      expect(await h.kit.runs.lastUpdateAt()).toBeNull();
      setClock(FRIDAY, HH(6));

      await orchestrator.tick();

      const run = await runOf(FRIDAY);
      expect(run).toMatchObject({
        outcome: 'SUCCESS',
        brasiliaDate: FRIDAY,
        listGeneratedAt: '2026-11-20',
        listRows: 10,
        attempts: 1,
        counts: { new: 10, changed: 0, unavailable: 0, active: 10 },
        collection: { collected: 7, failed: 1, blocked: false, pages: 0 },
        failureReasons: [],
        alertedAt: null,
        updateCompletedAt: brasiliaInstant(FRIDAY, HH(6)),
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      expect(await h.kit.auctionModel.countDocuments({ available: true })).toBe(10);
      expect(h.enrichment.calls).toEqual([{ importRunId: run?.id, brasiliaDate: FRIDAY }]);
      expect(h.events).toEqual([{ importRunId: run?.id, brasiliaDate: FRIDAY }]);
      expect(await h.kit.runs.lastUpdateAt()).toEqual(brasiliaInstant(FRIDAY, HH(6)));
      expect(h.health.recordExecution).toHaveBeenCalledTimes(1);
      expect(h.email.importAlertEmails).toHaveLength(0);
    });

    it('a second tick after SUCCESS does nothing: no request, no second pass, no second event', async () => {
      await fridayApplied();
      const before = await snapshot();

      await tickThrough(h.orchestrator(), FRIDAY, HH(6, 5), HH(12));

      expect(h.caixa.requests).toEqual([]);
      expect(h.enrichment.calls).toHaveLength(0);
      expect(h.events).toHaveLength(0);
      expect(await snapshot()).toEqual(before);
      expect(await runOf(FRIDAY)).toMatchObject({ outcome: 'SUCCESS', attempts: 1 });
    });

    it('does nothing before the window opens', async () => {
      setClock(FRIDAY, HH(5, 59));

      await h.orchestrator().tick();

      expect(h.caixa.requests).toEqual([]);
      expect(await runOf(FRIDAY)).toBeNull();
    });

    it('a valid new list on a Saturday is applied like on any day (BR-004-03)', async () => {
      await fridayApplied();
      h.caixa.serveList(list('21/11/2026', [...TEN, ['1010', 'Venda Online', '90.000,00']]));
      setClock(SATURDAY, HH(7));

      await h.orchestrator().tick();

      expect(await runOf(SATURDAY)).toMatchObject({
        outcome: 'SUCCESS',
        counts: { new: 1, changed: 0, unavailable: 0, active: 11 },
      });
      expect(h.events).toEqual([{ importRunId: expect.any(String), brasiliaDate: SATURDAY }]);
    });

    it('a collection that is blocked still completes the update and alerts once (BR-004-29)', async () => {
      h.enrichment.result = { collected: 2, failed: 0, blocked: true, pages: 0 };
      setClock(FRIDAY, HH(6));

      await h.orchestrator().tick();

      expect(await runOf(FRIDAY)).toMatchObject({
        outcome: 'SUCCESS',
        collection: { blocked: true },
      });
      expect(h.events).toHaveLength(1);
      expect(h.email.importAlertEmails).toHaveLength(2); // one per admin, one alert
      expect(h.email.importAlertEmails[0]?.alert).toMatchObject({
        outcomeLabel: 'Coleta de detalhes bloqueada',
      });
      await h.orchestrator().tick();
      expect(h.email.importAlertEmails).toHaveLength(2);
    });

    it('a fault of the collection pass does not hold the update back', async () => {
      h.enrichment.failWith = new TypeError('the pass broke');
      setClock(FRIDAY, HH(6));

      await h.orchestrator().tick();

      expect(await runOf(FRIDAY)).toMatchObject({
        outcome: 'SUCCESS',
        collection: { collected: 0, failed: 0, blocked: false, pages: 0 },
      });
      expect(h.events).toHaveLength(1);
      expect(h.email.importAlertEmails).toHaveLength(0);
    });
  });

  // --- (iii) / (iv): no new list ---------------------------------------------------------------

  describe('no new list (BR-004-02, BR-004-03, BR-004-10, BR-004-31)', () => {
    it('business day: retried within the attempts and spacing, NO_NEW_LIST at the cutoff, ONE alert, nothing moved', async () => {
      await fridayApplied();
      const before = await snapshot();
      const lastUpdate = await h.kit.runs.lastUpdateAt();
      h.caixa.serveList(FRIDAY_LIST); // Friday's list again: not newer than the applied one

      await tickThrough(h.orchestrator(), MONDAY, HH(6), HH(11, 55));

      // 06:00, 06:30, ... 11:30: twelve attempts, thirty minutes apart; the ticks between wait.
      expect(listRequests()).toBe(12);
      expect(await runOf(MONDAY)).toMatchObject({ outcome: 'RUNNING', attempts: 12 });
      expect(h.email.importAlertEmails).toHaveLength(0); // not decided before the cutoff

      setClock(MONDAY, HH(12));
      await h.orchestrator().tick();

      expect(listRequests()).toBe(12);
      expect(await runOf(MONDAY)).toMatchObject({
        outcome: 'NO_NEW_LIST',
        attempts: 12,
        failureReasons: ['NO_NEW_LIST'],
        finishedAt: brasiliaInstant(MONDAY, HH(12)),
        updateCompletedAt: null,
      });
      expect(h.email.importAlertEmails.map((mail) => mail.email).sort()).toEqual([
        'admin.dois@example.test',
        'admin.um@example.test',
      ]);
      expect(h.email.importAlertEmails[0]?.alert).toMatchObject({
        date: '23/11/2026',
        outcomeLabel: 'Sem lista nova em dia útil',
      });
      expect(await snapshot()).toEqual(before); // BR-004-10
      expect(await h.kit.runs.lastUpdateAt()).toEqual(lastUpdate); // BR-004-24
      expect(h.events).toHaveLength(0);
      expect(h.health.recordFailure).toHaveBeenCalledWith('auctions-import', 'AUTO', 'NO_NEW_LIST');
      // Later ticks of the day change nothing and send nothing more.
      await tickThrough(h.orchestrator(), MONDAY, HH(12, 5), HH(14));
      expect(h.email.importAlertEmails).toHaveLength(2);
      expect(listRequests()).toBe(12);
    });

    it.each([
      ['Saturday', SATURDAY, 'WEEKEND'],
      ['Sunday', SUNDAY, 'WEEKEND'],
    ])(
      '%s: NO_UPDATE at the cutoff, no email, no event, nothing moved (BR-004-03)',
      async (_name, day, reason) => {
        await fridayApplied();
        const before = await snapshot();
        const lastUpdate = await h.kit.runs.lastUpdateAt();

        await tickThrough(h.orchestrator(), day, HH(6), HH(12));

        expect(await runOf(day)).toMatchObject({
          outcome: 'NO_UPDATE',
          nonBusinessReason: reason,
          updateCompletedAt: null,
        });
        expect(h.email.importAlertEmails).toHaveLength(0);
        expect(h.events).toHaveLength(0);
        expect(await snapshot()).toEqual(before);
        expect(await h.kit.runs.lastUpdateAt()).toEqual(lastUpdate);
        // Health stays green: a day with nothing to publish is a success of the pipeline.
        expect(h.health.recordExecution).toHaveBeenCalledTimes(1);
        expect(h.health.recordFailure).not.toHaveBeenCalled();
      },
    );

    it('a configured holiday is NO_UPDATE; the same date unconfigured was a failed business day; adding it applies from the next run', async () => {
      await fridayApplied();
      // 24/12 Thursday, no holiday configured for the year: a business day with no new list.
      const unconfigured = h.orchestrator();
      await tickThrough(unconfigured, '2026-12-24', HH(6), HH(12));
      expect(await runOf('2026-12-24')).toMatchObject({ outcome: 'NO_NEW_LIST' });
      expect(h.email.importAlertEmails).toHaveLength(2);
      h.email.importAlertEmails.length = 0;

      // The operator adds 25/12 to NATIONAL_HOLIDAYS; the next run (a restart) reads it.
      const configured = h.orchestrator({ NATIONAL_HOLIDAYS: '2026-12-25' });
      await tickThrough(configured, '2026-12-25', HH(6), HH(12));
      expect(await runOf('2026-12-25')).toMatchObject({
        outcome: 'NO_UPDATE',
        nonBusinessReason: 'HOLIDAY',
      });
      expect(h.email.importAlertEmails).toHaveLength(0);

      // The next business day with no list is a failure again.
      await tickThrough(configured, '2026-12-28', HH(6), HH(12));
      expect(await runOf('2026-12-28')).toMatchObject({ outcome: 'NO_NEW_LIST' });
      expect(h.email.importAlertEmails).toHaveLength(2);
    });

    it('a calendar with no entry for the year counts weekends only, and warns', async () => {
      await fridayApplied();
      const logger = spyOnLogger();

      await tickThrough(h.orchestrator(), SATURDAY, HH(6), HH(12));

      expect(await runOf(SATURDAY)).toMatchObject({ outcome: 'NO_UPDATE' });
      expect(logger.loggedText()).toContain('NATIONAL_HOLIDAYS has no entries for 2026');
    });
  });

  // --- (v): unreachable and blocked ------------------------------------------------------------

  describe('Caixa unreachable or blocking (BR-004-03, BR-004-20, BR-004-29)', () => {
    it('unreachable on a weekend: FAILED when the attempts are used up, one alert', async () => {
      await fridayApplied();
      h.caixa.serveList(new CaixaUnreachableError('TIMEOUT'));

      await tickThrough(h.orchestrator(), SATURDAY, HH(6), HH(12));

      // Decided at the 12th attempt (11:30), before the cutoff: nothing a later attempt changes.
      expect(await runOf(SATURDAY)).toMatchObject({
        outcome: 'FAILED',
        attempts: 12,
        failureReasons: expect.arrayContaining(['TIMEOUT', 'LIST_UNREACHABLE']),
        finishedAt: brasiliaInstant(SATURDAY, HH(11, 30)),
      });
      expect(listRequests()).toBe(12);
      expect(h.email.importAlertEmails).toHaveLength(2);
      expect(h.email.importAlertEmails[0]?.alert).toMatchObject({
        outcomeLabel: 'Falhou',
        reasonText: expect.stringContaining('Não foi possível obter a lista'),
      });
      expect(h.events).toHaveLength(0);
    });

    it('a download that fails once and then answers ends the day normally, without an alert', async () => {
      h.caixa.serveList(new CaixaUnreachableError('NETWORK'));
      setClock(FRIDAY, HH(6));
      await h.orchestrator().tick();
      expect(await runOf(FRIDAY)).toMatchObject({ outcome: 'RUNNING', attempts: 1 });

      h.caixa.serveList(FRIDAY_LIST);
      setClock(FRIDAY, HH(6, 30));
      await h.orchestrator().tick();

      expect(await runOf(FRIDAY)).toMatchObject({ outcome: 'SUCCESS', attempts: 2 });
      expect(h.email.importAlertEmails).toHaveLength(0);
    });

    it('blocked: FAILED at once, never retried that day, one alert', async () => {
      await fridayApplied();
      h.caixa.serveList(new CaixaBlockedError('HTTP_403'));
      const orchestrator = h.orchestrator();

      await tickThrough(orchestrator, MONDAY, HH(6), HH(14));

      expect(listRequests()).toBe(1);
      expect(await runOf(MONDAY)).toMatchObject({
        outcome: 'FAILED',
        attempts: 1,
        failureReasons: ['HTTP_403', 'LIST_BLOCKED'],
        finishedAt: brasiliaInstant(MONDAY, HH(6)),
      });
      expect(h.email.importAlertEmails).toHaveLength(2);
      expect(h.email.importAlertEmails[0]?.alert.reasonText).toContain('bloqueou');
      expect(h.health.recordFailure).toHaveBeenCalledWith(
        'auctions-import',
        'AUTO',
        'LIST_BLOCKED',
      );
    });

    it('a failure to read anything but Caixa (the cache, the storage) counts as an attempt without an answer', async () => {
      class StorageError extends Error {
        override name = 'StorageError';
      }
      h.caixa.serveList(new StorageError('private detail'));
      setClock(FRIDAY, HH(6));

      await h.orchestrator().tick();

      expect(await runOf(FRIDAY)).toMatchObject({
        outcome: 'RUNNING',
        attempts: 1,
        failureReasons: ['StorageError'], // the class, never the message (SC-15)
      });
    });
  });

  // --- (vi): rejected lists --------------------------------------------------------------------

  describe('rejected lists (BR-004-04, BR-004-10, BR-004-29)', () => {
    it('a truncated list (30%): REJECTED_LIST, nothing applied, no entries, ONE alert, "last updated" unmoved', async () => {
      await fridayApplied();
      const before = await snapshot();
      const lastUpdate = await h.kit.runs.lastUpdateAt();
      h.caixa.serveList(list('23/11/2026', TEN.slice(0, 3)));

      await tickThrough(h.orchestrator(), MONDAY, HH(6), HH(12));

      expect(await runOf(MONDAY)).toMatchObject({
        outcome: 'REJECTED_LIST',
        listGeneratedAt: '2026-11-23',
        listRows: 3,
        failureReasons: ['TRUNCATED_LIST'],
        progress: { rejection: { generatedOn: '2026-11-23', reason: 'TRUNCATED_LIST' } },
      });
      expect(await snapshot()).toEqual(before);
      expect(await h.kit.auctionModel.countDocuments({ available: false })).toBe(0);
      expect(await h.kit.runs.lastUpdateAt()).toEqual(lastUpdate);
      expect(h.email.importAlertEmails).toHaveLength(2);
      expect(h.email.importAlertEmails[0]?.alert).toMatchObject({
        outcomeLabel: 'Lista rejeitada',
        codes: ['TRUNCATED_LIST'],
      });
      expect(h.health.recordFailure).toHaveBeenCalledWith(
        'auctions-import',
        'AUTO',
        'LIST_REJECTED',
      );
    });

    it('the same refused file is not judged again: still one rejection, and the day is decided when the attempts run out', async () => {
      await fridayApplied();
      h.caixa.serveList(list('23/11/2026', TEN.slice(0, 3)));

      await tickThrough(h.orchestrator(), MONDAY, HH(6), HH(12));

      expect(listRequests()).toBe(12);
      expect(await runOf(MONDAY)).toMatchObject({
        failureReasons: ['TRUNCATED_LIST'],
        finishedAt: brasiliaInstant(MONDAY, HH(11, 30)),
      });
    });

    it('a wrong layout is rejected the same way', async () => {
      await fridayApplied();
      const before = await snapshot();
      h.caixa.serveList(readCaixaFixture('lista-unrecognised-layout.csv'));

      await tickThrough(h.orchestrator(), MONDAY, HH(6), HH(12));

      expect(await runOf(MONDAY)).toMatchObject({
        outcome: 'REJECTED_LIST',
        failureReasons: ['UNRECOGNISED_LAYOUT'],
      });
      expect(await snapshot()).toEqual(before);
      expect(h.email.importAlertEmails).toHaveLength(2);
    });

    it('a refused list on a weekend still alerts: a published list that cannot be used is no quiet day', async () => {
      await fridayApplied();
      h.caixa.serveList(list('21/11/2026', TEN.slice(0, 3)));

      await tickThrough(h.orchestrator(), SATURDAY, HH(6), HH(12));

      expect(await runOf(SATURDAY)).toMatchObject({ outcome: 'REJECTED_LIST' });
      expect(h.email.importAlertEmails).toHaveLength(2);
    });

    it('a newer valid list later the same day is applied: the day ends SUCCESS, never alerts, and keeps the rejection as history', async () => {
      await fridayApplied();
      h.caixa.serveList(list('23/11/2026', TEN.slice(0, 3)));
      const orchestrator = h.orchestrator();
      await tickThrough(orchestrator, MONDAY, HH(6), HH(7, 55));
      expect(await runOf(MONDAY)).toMatchObject({ outcome: 'RUNNING' });

      h.caixa.serveList(list('23/11/2026', [...TEN, ['1010', 'Venda Online', '95.000,00']]));
      await tickThrough(orchestrator, MONDAY, HH(8), HH(12));

      expect(await runOf(MONDAY)).toMatchObject({
        outcome: 'SUCCESS',
        counts: { new: 1, changed: 0, unavailable: 0, active: 11 },
        failureReasons: ['TRUNCATED_LIST'],
        alertedAt: null,
      });
      expect(h.email.importAlertEmails).toHaveLength(0);
      expect(h.events).toHaveLength(1);
    });

    it('SC-24: a list whose property link points off Caixa is stored without the link', async () => {
      h.caixa.serveList(
        list('20/11/2026', [['1000', 'Venda Online', '100.000,00']]).replace(
          'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1000',
          'https://evil.example/detalhe-imovel.asp?hdnimovel=1000',
        ),
      );
      setClock(FRIDAY, HH(6));

      await h.orchestrator().tick();

      expect(
        (await h.kit.auctionModel.collection.findOne({ code: '1000' }))?.['detailsUrl'],
      ).toBeNull();
    });
  });

  // --- the apply failing ---------------------------------------------------------------------

  describe('an apply that fails (BR-004-07, BR-004-08)', () => {
    class Dying extends ListApplierRepository {
      override applyChunk(): Promise<void> {
        return Promise.reject(new TypeError('the database went away'));
      }
    }
    const dying = () => new ListApplier(new Dying(h.kit.auctionModel), h.kit.changes, h.clock);

    it('is retried at the spacing with the list as it is, and ends SUCCESS when it works: no alert', async () => {
      await fridayApplied();
      const before = await snapshot();
      h.caixa.serveList(
        list('23/11/2026', [...TEN.slice(0, 9), ['2000', 'Venda Online', '50.000,00']]),
      );
      setClock(MONDAY, HH(6));

      await h.orchestrator({}, { applier: dying() }).tick();

      expect(await runOf(MONDAY)).toMatchObject({
        outcome: 'RUNNING',
        attempts: 1,
        failureReasons: ['TypeError'],
        progress: { applying: false, applyFailed: true },
      });
      expect((await snapshot()).auctions).toEqual(before.auctions); // nothing hidden, nothing changed

      setClock(MONDAY, HH(6, 30));
      await h.orchestrator().tick();

      expect(await runOf(MONDAY)).toMatchObject({
        outcome: 'SUCCESS',
        attempts: 2,
        counts: { new: 1, changed: 0, unavailable: 1, active: 10 },
        alertedAt: null,
      });
      expect(h.email.importAlertEmails).toHaveLength(0);
    });

    it('all day: FAILED with the class as a code, one alert, nothing hidden', async () => {
      await fridayApplied();
      h.caixa.serveList(MONDAY_LIST);
      const before = await snapshot();

      await tickThrough(h.orchestrator({}, { applier: dying() }), MONDAY, HH(6), HH(12));

      expect(await runOf(MONDAY)).toMatchObject({
        outcome: 'FAILED',
        failureReasons: expect.arrayContaining(['TypeError', 'APPLY_FAILED']),
      });
      expect((await snapshot()).auctions).toEqual(before.auctions);
      expect(h.email.importAlertEmails).toHaveLength(2);
    });

    it('the first list over a legacy catalogue it would mostly hide: refused by the sweep guard, nothing hidden', async () => {
      const phase = { modality: 'ONLINE_SALES', minimumPrice: Types.Decimal128.fromString('1') };
      await h.kit.auctionModel.collection.insertMany(
        Array.from({ length: 50 }, (_, i) => ({
          code: `${5000 + i}`,
          available: true,
          fulfilled: true,
          phases: [phase],
          currentPhase: phase,
          updatedAt: h.clock.now(),
        })),
      );
      setClock(FRIDAY, HH(6));

      await h.orchestrator().tick();

      expect(await h.kit.auctionModel.countDocuments({ available: false })).toBe(0);
      expect(await runOf(FRIDAY)).toMatchObject({
        outcome: 'RUNNING',
        failureReasons: [SweepAbortedError.name],
      });
      expect(await h.kit.runs.lastAppliedList()).toBeNull();
    });
  });

  // --- (viii): concurrency and crashes -------------------------------------------------------

  describe('overlapping ticks and processes (the lease)', () => {
    it('two ticks at once: one worker, one run, one request, one event', async () => {
      const [a, b] = [h.orchestrator(), h.orchestrator()];
      setClock(FRIDAY, HH(6));

      await Promise.all([a.tick(), b.tick(), a.tick(), b.tick()]);

      expect(await h.kit.runModel.countDocuments({})).toBe(1);
      expect(listRequests()).toBe(1);
      expect(h.enrichment.calls).toHaveLength(1);
      expect(h.events).toHaveLength(1);
      expect(await runOf(FRIDAY)).toMatchObject({ outcome: 'SUCCESS', attempts: 1 });
    });

    it('several ticks at the cutoff: one decision, ONE alert, one health record', async () => {
      await fridayApplied();
      h.caixa.serveList(FRIDAY_LIST);
      const ticks = [h.orchestrator(), h.orchestrator(), h.orchestrator()];
      await tickThrough(
        ticks[0] as ReturnType<ImportHarness['orchestrator']>,
        MONDAY,
        HH(6),
        HH(11, 55),
      );
      setClock(MONDAY, HH(12));

      await Promise.all(ticks.flatMap((tick) => [tick.tick(), tick.tick()]));

      expect(await runOf(MONDAY)).toMatchObject({ outcome: 'NO_NEW_LIST' });
      expect(h.email.importAlertEmails).toHaveLength(2);
      expect(h.health.recordFailure).toHaveBeenCalledTimes(1);
    });

    it('a worker killed in the middle of the apply: its lease holds the run until it expires, then the next attempt finishes the day from the STORED copy, never asking Caixa', async () => {
      await fridayApplied();
      await killedMidApply(
        list('23/11/2026', [
          ...TEN,
          ['1010', 'Venda Online', '95.000,00'],
          ['1011', 'Venda Online', '95.000,00'],
        ]),
      );
      expect(await runOf(MONDAY)).toMatchObject({
        outcome: 'RUNNING',
        progress: { applying: true },
      });
      expect(listRequests()).toBe(1);

      // A live lease: the next tick, even of another process, leaves the run alone.
      setClock(MONDAY, HH(6, 2)); // the lease runs five minutes
      await h.orchestrator().tick();
      expect(listRequests()).toBe(1);

      // Expired, but the spacing of attempt 1 holds the next one back until 06:30.
      setClock(MONDAY, HH(6, 10));
      await h.orchestrator().tick();
      expect(await runOf(MONDAY)).toMatchObject({ outcome: 'RUNNING', attempts: 1 });

      // Caixa now blocks: a resume asks nobody, so it cannot see it (SC-24, BR-004-07).
      h.caixa.serveList(new CaixaBlockedError('HTTP_403'));
      setClock(MONDAY, HH(6, 30));
      await h.orchestrator().tick();

      expect(listRequests()).toBe(1);
      expect(await runOf(MONDAY)).toMatchObject({
        outcome: 'SUCCESS',
        counts: { new: 2, changed: 0, unavailable: 0, active: 12 },
        attempts: 2,
        failureReasons: ['APPLY_INTERRUPTED'], // the history of the day stays
      });
      expect(h.events).toHaveLength(1);
      expect(await h.kit.auctionModel.countDocuments({ available: true })).toBe(12);
    });

    describe('a resume that finds no valid list to finish (SC-24, BR-004-07, BR-004-10)', () => {
      const TICKS = 100; // every five minutes from 06:05: past the cutoff and the attempts

      it('the stored copy is truncated: refused, applying cleared, never stuck; decided FAILED when the attempts run out, one alert, bounded requests', async () => {
        await fridayApplied();
        const before = await snapshot();
        await killedMidApply(MONDAY_LIST);
        const truncated = list('23/11/2026', TEN.slice(0, 3));
        h.storage.files.set('importer/Lista_imoveis_geral.csv', Buffer.from(truncated));
        h.caixa.serveList(truncated); // and what Caixa serves now is no better

        await tickN(h.orchestrator(), MONDAY, HH(6, 5), TICKS);

        const run = await runOf(MONDAY);
        expect(run).toMatchObject({
          outcome: 'FAILED', // a list that passed validation was never applied: the day's news
          attempts: 12,
          failureReasons: ['APPLY_INTERRUPTED', 'TRUNCATED_LIST', 'APPLY_FAILED'],
          progress: { applying: false, applyFailed: true },
        });
        // One request for the killed worker's attempt, then one per attempt from the 3rd on (the
        // 2nd was the resume, which asked nobody): never more than the attempts.
        expect(listRequests()).toBe(11);
        expect(h.email.importAlertEmails).toHaveLength(2);
        expect((await snapshot()).auctions).toEqual(before.auctions);
      });

      it('the stored copy is not new: the resume gives up, the searches see no new list, FAILED when the attempts run out, one alert', async () => {
        await fridayApplied();
        await killedMidApply(MONDAY_LIST);
        h.storage.files.set('importer/Lista_imoveis_geral.csv', Buffer.from(FRIDAY_LIST));
        h.caixa.serveList(FRIDAY_LIST);

        await tickN(h.orchestrator(), MONDAY, HH(6, 5), TICKS);

        expect(await runOf(MONDAY)).toMatchObject({
          outcome: 'FAILED',
          attempts: 12,
          failureReasons: ['APPLY_INTERRUPTED', 'APPLY_FAILED'],
          progress: { applying: false, applyFailed: true },
        });
        expect(listRequests()).toBe(11);
        expect(h.email.importAlertEmails).toHaveLength(2);
        expect(h.events).toHaveLength(0);
      });

      it('no stored copy and Caixa unreachable: the resume falls back to a search, FAILED when the attempts run out, one request per attempt, one alert', async () => {
        await fridayApplied();
        await killedMidApply(MONDAY_LIST);
        h.storage.files.clear(); // the copy is gone
        h.caixa.serveList(new CaixaUnreachableError('TIMEOUT'));

        await tickN(h.orchestrator(), MONDAY, HH(6, 5), TICKS);

        expect(await runOf(MONDAY)).toMatchObject({
          outcome: 'FAILED',
          attempts: 12,
          progress: { applying: false },
          failureReasons: ['APPLY_INTERRUPTED', 'TIMEOUT', 'APPLY_FAILED'],
        });
        expect(listRequests()).toBe(12); // the killed attempt + the 11 others, each once
        expect(h.email.importAlertEmails).toHaveLength(2);
      });

      it('no stored copy but Caixa serves the list again: the fallback search applies it', async () => {
        await fridayApplied();
        await killedMidApply(MONDAY_LIST);
        h.storage.files.clear();

        await tickN(h.orchestrator(), MONDAY, HH(6, 5), 10);

        expect(await runOf(MONDAY)).toMatchObject({ outcome: 'SUCCESS', attempts: 2 });
        expect(listRequests()).toBe(2);
      });

      it('R2 not set up (development): the same fallback', async () => {
        await fridayApplied();
        await killedMidApply(MONDAY_LIST);
        h.storage.configured = false;

        await tickN(h.orchestrator(), MONDAY, HH(6, 5), 10);

        expect(await runOf(MONDAY)).toMatchObject({ outcome: 'SUCCESS', attempts: 2 });
      });

      it('a worker killed too close to the cutoff is not resumed: the day ends FAILED APPLY_FAILED, with one alert', async () => {
        await fridayApplied();
        h.caixa.serveList(MONDAY_LIST);
        setClock(MONDAY, HH(11, 45));
        void h.orchestrator({}, { applier: applierThatStalls(0) }).tick();
        await waitFor(async () => (await runOf(MONDAY))?.progress.applying === true);

        await tickN(h.orchestrator(), MONDAY, HH(11, 50), 5);

        expect(await runOf(MONDAY)).toMatchObject({
          outcome: 'FAILED',
          failureReasons: ['APPLY_FAILED'],
          finishedAt: brasiliaInstant(MONDAY, HH(12)),
        });
        expect(listRequests()).toBe(1);
        expect(h.email.importAlertEmails).toHaveLength(2);
      });

      it('a list that throws while being turned into rows cannot leave the run applying', async () => {
        await fridayApplied();
        h.caixa.serveList(MONDAY_LIST);
        const broken = { apply: () => Promise.reject(new TypeError('private detail')) };
        setClock(MONDAY, HH(6));

        await h.orchestrator({}, { applier: broken as unknown as ListApplier }).tick();

        expect(await runOf(MONDAY)).toMatchObject({
          progress: { applying: false, applyFailed: true },
          failureReasons: ['TypeError'],
        });
      });
    });

    it('a worker killed between the apply and the collection: the next tick, after the lease expires, collects and completes once', async () => {
      h.enrichment.hook = () => new Promise<void>(() => undefined); // the pass never answers
      setClock(FRIDAY, HH(6));
      void h.orchestrator().tick();
      await waitFor(() => h.enrichment.calls.length === 1);
      expect(await runOf(FRIDAY)).toMatchObject({ outcome: 'SUCCESS', updateCompletedAt: null });

      // Held: nothing happens, no second pass, no signal.
      setClock(FRIDAY, HH(6, 2)); // the lease runs five minutes
      await h.orchestrator().tick();
      expect(h.enrichment.calls).toHaveLength(1);
      expect(h.events).toHaveLength(0);

      h.enrichment.hook = null;
      h.clock.advance(RUN_LEASE_MS);
      await Promise.all([h.orchestrator().tick(), h.orchestrator().tick()]);

      expect(h.enrichment.calls).toHaveLength(2); // idempotent pass, run again
      expect(h.events).toHaveLength(1); // the signal, once
      expect(await runOf(FRIDAY)).toMatchObject({
        outcome: 'SUCCESS',
        updateCompletedAt: h.clock.now(),
      });
      expect(listRequests()).toBe(1);
    });

    it('an applied run whose collection was cut short crosses midnight keeping its date, and is completed there (findOpen)', async () => {
      await fridayApplied();
      h.caixa.serveList(MONDAY_LIST);
      h.enrichment.hook = () => new Promise<void>(() => undefined);
      setClock(MONDAY, HH(11, 30));
      void h.orchestrator().tick();
      await waitFor(() => h.enrichment.calls.length === 1);
      h.enrichment.hook = null;

      // 00:10 on Tuesday, long after the lease expired: Monday's run is completed under Monday's date.
      h.clock.set(brasiliaInstant(TUESDAY, 10));
      await h.orchestrator().tick();

      expect(await runOf(MONDAY)).toMatchObject({
        outcome: 'SUCCESS',
        brasiliaDate: MONDAY,
        updateCompletedAt: brasiliaInstant(TUESDAY, 10),
      });
      expect(h.events).toEqual([{ importRunId: expect.any(String), brasiliaDate: MONDAY }]);
      expect(await runOf(TUESDAY)).toBeNull(); // Tuesday's window has not opened
    });
  });

  describe('the lease and the once-only claims, on the row (BR-004-07, BR-004-23, BR-004-29)', () => {
    it('exactly one of many concurrent acquirers gets the run; the holder renews, others cannot', async () => {
      const run = await h.kit.runs.ensure(MONDAY);

      const results = await Promise.all(
        ['a', 'b', 'c', 'd', 'e'].map((owner) => h.kit.runs.acquireLease(run.id, owner)),
      );

      expect(results.filter((result) => result !== null)).toHaveLength(1);
      const holder = results.find((result) => result !== null)?.leaseOwner as string;
      expect(await h.kit.runs.renewLease(run.id, holder)).toBe(true);
      expect(await h.kit.runs.renewLease(run.id, 'stranger')).toBe(false);
    });

    it('an expired lease is taken over, and the old holder is fenced out of every write', async () => {
      const run = await h.kit.runs.ensure(MONDAY);
      await h.kit.runs.acquireLease(run.id, 'old');
      h.clock.advance(RUN_LEASE_MS);

      expect(await h.kit.runs.acquireLease(run.id, 'new')).toMatchObject({ leaseOwner: 'new' });

      expect(await h.kit.runs.beginAttempt(run.id, 'old', new Date())).toBe(false);
      expect(
        await h.kit.runs.markSuccess(run.id, 'old', {
          new: 1,
          changed: 0,
          unavailable: 0,
          active: 1,
        }),
      ).toBe(false);
      expect(
        await h.kit.runs.finalize(run.id, 'old', {
          outcome: 'FAILED',
          reason: 'X',
          nonBusinessReason: null,
        }),
      ).toBe(false);
      expect(await h.kit.runs.beginAttempt(run.id, 'new', new Date())).toBe(true);
      await h.kit.runs.releaseLease(run.id, 'old'); // not the holder: a no-op
      expect((await runOf(MONDAY))?.leaseOwner).toBe('new');
      await h.kit.runs.releaseLease(run.id, 'new');
      expect(await h.kit.runs.acquireLease(run.id, 'third')).not.toBeNull();
    });

    it('a fenced write that changes nothing still holds: the same code twice in one millisecond, a renewal at the same instant (the flake of the spacing test)', async () => {
      // Mongoose stamps `updatedAt` with the real time; frozen, two writes of the same value in one
      // millisecond change nothing, and a fence judged by "modified" would read that as a lost lease.
      vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-23T11:00:00.000Z') });
      try {
        const run = await h.kit.runs.ensure(MONDAY);
        await h.kit.runs.acquireLease(run.id, 'w');

        expect(await h.kit.runs.recordFailureCode(run.id, 'w', 'TIMEOUT')).toBe(true);
        expect(await h.kit.runs.recordFailureCode(run.id, 'w', 'TIMEOUT')).toBe(true);
        expect(await h.kit.runs.renewLease(run.id, 'w')).toBe(true);
        expect(await h.kit.runs.renewLease(run.id, 'w')).toBe(true);
        expect(await h.kit.runs.markListReached(run.id, 'w')).toBe(true);
        expect(await h.kit.runs.markListReached(run.id, 'w')).toBe(true);
        // ...and still a stranger's write matches nothing.
        expect(await h.kit.runs.recordFailureCode(run.id, 'stranger', 'TIMEOUT')).toBe(false);
        expect(await h.kit.runs.renewLease(run.id, 'stranger')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });

    it('one run per Brasília date however many create it at once', async () => {
      const created = await Promise.all(Array.from({ length: 6 }, () => h.kit.runs.ensure(MONDAY)));

      expect(new Set(created.map((run) => run.id)).size).toBe(1);
      expect(await h.kit.runModel.countDocuments({})).toBe(1);
    });

    it('completeUpdate is true for exactly one caller, and only for an applied run (BR-004-23)', async () => {
      const run = await h.kit.runs.ensure(MONDAY);
      expect(await h.kit.runs.completeUpdate(run.id)).toBe(false); // not applied

      await h.kit.runs.acquireLease(run.id, 'w');
      await h.kit.runs.markSuccess(run.id, 'w', { new: 1, changed: 0, unavailable: 0, active: 1 });
      const wins = await Promise.all(
        Array.from({ length: 8 }, () => h.kit.runs.completeUpdate(run.id)),
      );

      expect(wins.filter(Boolean)).toHaveLength(1);
    });

    it('claimAlert is true for exactly one caller until it is released', async () => {
      const run = await h.kit.runs.ensure(MONDAY);

      const wins = await Promise.all(
        Array.from({ length: 8 }, () => h.kit.runs.claimAlert(run.id)),
      );
      expect(wins.filter(Boolean)).toHaveLength(1);

      await h.kit.runs.releaseAlert(run.id);
      expect(await h.kit.runs.claimAlert(run.id)).toBe(true);
    });

    it('"last updated" is the newest COMPLETED update, never a run that only ended', async () => {
      const friday = await h.kit.runs.ensure(FRIDAY);
      await h.kit.runs.acquireLease(friday.id, 'w');
      await h.kit.runs.markSuccess(friday.id, 'w', {
        new: 1,
        changed: 0,
        unavailable: 0,
        active: 1,
      });
      expect(await h.kit.runs.lastUpdateAt()).toBeNull(); // applied but the update is not complete
      await h.kit.runs.completeUpdate(friday.id);
      const completed = await h.kit.runs.lastUpdateAt();
      expect(completed).toEqual(h.clock.now());

      h.clock.advance(60 * 60_000);
      const monday = await h.kit.runs.ensure(MONDAY);
      await h.kit.runs.acquireLease(monday.id, 'w');
      await h.kit.runs.finalize(monday.id, 'w', {
        outcome: 'NO_NEW_LIST',
        reason: 'NO_NEW_LIST',
        nonBusinessReason: null,
      });

      expect(await h.kit.runs.lastUpdateAt()).toEqual(completed);
    });
  });

  // --- a day nobody attempted (BR-004-03, BR-004-29) -----------------------------------------

  describe('a day nobody attempted', () => {
    it('process down all morning, on a business day: the first tick after the cutoff records FAILED NO_ATTEMPT, alerts once, tells health', async () => {
      await fridayApplied();
      const before = await snapshot();

      setClock(MONDAY, HH(12, 5)); // the process came back at 12:05
      await h.orchestrator().tick();

      expect(await runOf(MONDAY)).toMatchObject({
        outcome: 'FAILED',
        attempts: 0,
        failureReasons: ['NO_ATTEMPT'],
        finishedAt: brasiliaInstant(MONDAY, HH(12, 5)),
        updateCompletedAt: null,
      });
      expect(listRequests()).toBe(0); // nothing is asked of Caixa after the cutoff
      expect(h.email.importAlertEmails).toHaveLength(2);
      expect(h.email.importAlertEmails[0]?.alert.reasonText).toContain('Nenhuma tentativa');
      expect(h.health.recordFailure).toHaveBeenCalledWith('auctions-import', 'AUTO', 'NO_ATTEMPT');
      expect(await snapshot()).toEqual(before);

      await tickThrough(h.orchestrator(), MONDAY, HH(12, 10), HH(18));
      expect(h.email.importAlertEmails).toHaveLength(2);
      expect(await h.kit.runModel.countDocuments({ brasiliaDate: MONDAY })).toBe(1);
    });

    it('IMPORT_ENABLED switched on after the cutoff: the tick that follows alerts once (expected the first day)', async () => {
      // The job class does not tick while the flag is off (scheduler.spec.ts); the first tick after
      // it is switched on, past the cutoff, is the first time anything looks at the day.
      setClock(FRIDAY, HH(14));

      await h.orchestrator().tick();

      expect(await runOf(FRIDAY)).toMatchObject({
        outcome: 'FAILED',
        failureReasons: ['NO_ATTEMPT'],
      });
      expect(h.email.importAlertEmails).toHaveLength(2);
    });

    it('a concurrent pair of first ticks after the cutoff: one run, one alert', async () => {
      setClock(FRIDAY, HH(12, 5));
      await Promise.all([
        h.orchestrator().tick(),
        h.orchestrator().tick(),
        h.orchestrator().tick(),
      ]);

      expect(await h.kit.runModel.countDocuments({})).toBe(1);
      expect(h.email.importAlertEmails).toHaveLength(2);
      expect(h.health.recordFailure).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['a Saturday', SATURDAY, ''],
      ['a Sunday', SUNDAY, ''],
      ['a configured holiday', '2026-12-25', '2026-12-25'],
    ])(
      '%s: nothing is recorded, nobody is told, nothing is asked of Caixa',
      async (_name, day, holidays) => {
        setClock(day, HH(13));

        await h.orchestrator(holidays ? { NATIONAL_HOLIDAYS: holidays } : {}).tick();

        expect(await runOf(day)).toBeNull();
        expect(h.email.importAlertEmails).toHaveLength(0);
        expect(h.health.recordFailure).not.toHaveBeenCalled();
        expect(listRequests()).toBe(0);
      },
    );
  });

  // --- fresh downloads and the stored copy (SC-24, BR-004-02, BR-004-07) -----------------------

  describe('a search asks Caixa afresh; the stored copy is for a resume only', () => {
    it('a later list after an older one was stored the same day is seen', async () => {
      await fridayApplied();
      h.caixa.serveList(FRIDAY_LIST); // 06:00: still Friday's list, stored as today's copy
      const orchestrator = h.orchestrator();
      setClock(MONDAY, HH(6));
      await orchestrator.tick();
      expect(listRequests()).toBe(1);
      expect(h.storage.files.get('importer/Lista_imoveis_geral.csv')?.toString()).toBe(FRIDAY_LIST);

      h.caixa.serveList(MONDAY_LIST); // 06:30: Caixa published
      setClock(MONDAY, HH(6, 30));
      await orchestrator.tick();

      expect(listRequests()).toBe(2); // asked again: the stored Friday copy was not served
      expect(await runOf(MONDAY)).toMatchObject({ outcome: 'SUCCESS', attempts: 2 });
      expect(h.storage.files.get('importer/Lista_imoveis_geral.csv')?.toString()).toBe(MONDAY_LIST);
    });

    it('every search is one request, and the stored copy is replaced each time', async () => {
      await fridayApplied();
      h.caixa.serveList(FRIDAY_LIST);

      await tickThrough(h.orchestrator(), MONDAY, HH(6), HH(8));

      expect(listRequests()).toBe(5); // 06:00, 06:30, 07:00, 07:30, 08:00
    });
  });

  // --- claims decided by the value written (BR-004-23, BR-004-29) ------------------------------

  describe('once-only claims, with a different instant per caller', () => {
    const repository = () => new ImportRunRepository(h.kit.runModel);
    const base = brasiliaInstant(MONDAY, HH(9)).getTime();
    const instant = (i: number) => new Date(base + i * 1000);

    it("completeUpdate: one winner, and the stored instant is the winner's own (a dropped null guard would keep the last writer's)", async () => {
      const run = await h.kit.runs.ensure(MONDAY);
      await h.kit.runs.acquireLease(run.id, 'w');
      await h.kit.runs.markSuccess(run.id, 'w', { new: 1, changed: 0, unavailable: 0, active: 1 });

      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => repository().completeUpdate(run.id, instant(i))),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      const winner = results.indexOf(true);
      expect((await runOf(MONDAY))?.updateCompletedAt).toEqual(instant(winner));
      // Sequentially, too: a later caller changes nothing.
      expect(await repository().completeUpdate(run.id, instant(99))).toBe(false);
      expect((await runOf(MONDAY))?.updateCompletedAt).toEqual(instant(winner));
    });

    it("claimAlert: one winner, the stored instant is the winner's, a later caller changes nothing", async () => {
      const run = await h.kit.runs.ensure(MONDAY);

      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) => repository().claimAlert(run.id, instant(i))),
      );

      expect(results.filter(Boolean)).toHaveLength(1);
      const winner = results.indexOf(true);
      expect((await runOf(MONDAY))?.alertedAt).toEqual(instant(winner));
      expect(await repository().claimAlert(run.id, instant(99))).toBe(false);
      expect((await runOf(MONDAY))?.alertedAt).toEqual(instant(winner));
    });

    it('the signal is emitted only by the worker that won the claim', async () => {
      // While the pass runs, "another worker" completes the update first.
      let outsideWon = false;
      h.enrichment.hook = async () => {
        const run = await runOf(FRIDAY);
        h.clock.advance(1000);
        outsideWon = await h.kit.runs.completeUpdate(run?.id ?? '');
      };
      setClock(FRIDAY, HH(6));

      await h.orchestrator().tick();

      expect(outsideWon).toBe(true);
      expect(h.events).toHaveLength(0); // the loser of the claim emits nothing
      expect(h.health.recordExecution).not.toHaveBeenCalled();
      expect(await runOf(FRIDAY)).toMatchObject({ outcome: 'SUCCESS' });
    });
  });

  // --- losing the lease mid-work, and keeping it (item: fencing) -------------------------------

  describe('the lease while working', () => {
    /** Another process takes the run over: the clock passes the lease's end and a thief acquires it. */
    async function steal(day: string) {
      h.clock.advance(RUN_LEASE_MS + 1000);
      const run = await runOf(day);
      return h.kit.runs.acquireLease(run?.id ?? '', 'thief');
    }

    it('a worker that loses the lease during the apply writes nothing more: no SUCCESS, no pass, no signal', async () => {
      const real = h.kit.applier;
      const losing = {
        apply: async (input: Parameters<ListApplier['apply']>[0]) => {
          const counts = await real.apply(input);
          expect(await steal(FRIDAY)).not.toBeNull();
          return counts;
        },
      };
      setClock(FRIDAY, HH(6));

      await h.orchestrator({}, { applier: losing as unknown as ListApplier }).tick();

      expect(await runOf(FRIDAY)).toMatchObject({
        outcome: 'RUNNING',
        counts: { new: 0, changed: 0, unavailable: 0, active: 0 },
        leaseOwner: 'thief',
      });
      expect(h.enrichment.calls).toHaveLength(0);
      expect(h.events).toHaveLength(0);
    });

    it('a worker that loses the lease before the collection pass does not start it, nor complete the day', async () => {
      h.auctions.invalidateNeighborhoodsCache.mockImplementation(async () => {
        await steal(FRIDAY);
      });
      setClock(FRIDAY, HH(6));

      await h.orchestrator().tick();

      expect(await runOf(FRIDAY)).toMatchObject({ outcome: 'SUCCESS', updateCompletedAt: null });
      expect(h.enrichment.calls).toHaveLength(0);
      expect(h.events).toHaveLength(0);
    });

    it('a worker that loses the lease during the pass does not store its result, nor complete the day', async () => {
      h.enrichment.result = { collected: 9, failed: 0, blocked: false, pages: 0 };
      h.enrichment.hook = async () => {
        await steal(FRIDAY);
      };
      setClock(FRIDAY, HH(6));

      await h.orchestrator().tick();

      expect(await runOf(FRIDAY)).toMatchObject({
        outcome: 'SUCCESS',
        collection: { collected: 0, failed: 0, blocked: false, pages: 0 },
        updateCompletedAt: null,
      });
      expect(h.events).toHaveLength(0);
      expect(h.health.recordExecution).not.toHaveBeenCalled();
    });

    it('a worker that loses the lease right after storing the pass result does not complete the day', async () => {
      const original = h.kit.runs.saveCollection.bind(h.kit.runs);
      const spy = vi
        .spyOn(h.kit.runs, 'saveCollection')
        .mockImplementation(async (...args: Parameters<typeof original>) => {
          const stored = await original(...args);
          await steal(FRIDAY);
          return stored;
        });
      setClock(FRIDAY, HH(6));
      try {
        await h.orchestrator().tick();
      } finally {
        spy.mockRestore();
      }

      expect(await runOf(FRIDAY)).toMatchObject({ outcome: 'SUCCESS', updateCompletedAt: null });
      expect(h.events).toHaveLength(0);
      expect(h.health.recordExecution).not.toHaveBeenCalled();
    });

    it('a long apply keeps its lease through the heartbeat: nobody takes the run over, one worker finishes the day', async () => {
      const real = h.kit.applier;
      let takeoverAttempt: unknown = 'not tried';
      const slow = {
        apply: async (input: Parameters<ListApplier['apply']>[0]) => {
          // Three lease periods of clock time pass in 300 ms of real time; the heartbeat (20 ms)
          // renews against the clock, so a rival tick finds the lease still held each time.
          for (let i = 0; i < 3; i++) {
            h.clock.advance(RUN_LEASE_MS - 60_000);
            await new Promise((resolve) => setTimeout(resolve, 100));
            const run = await runOf(FRIDAY);
            takeoverAttempt = await h.kit.runs.acquireLease(run?.id ?? '', 'rival');
            if (takeoverAttempt !== null) break;
          }
          return real.apply(input);
        },
      };
      setClock(FRIDAY, HH(6));

      await h
        .orchestrator({}, { applier: slow as unknown as ListApplier, leaseRenewMs: 20 })
        .tick();

      expect(takeoverAttempt).toBeNull();
      expect(await runOf(FRIDAY)).toMatchObject({ outcome: 'SUCCESS', attempts: 1 });
      expect(h.events).toHaveLength(1);
      expect(listRequests()).toBe(1);
    });

    it('without the heartbeat the same slow apply WOULD be taken over (the guard the previous test needs)', async () => {
      const real = h.kit.applier;
      let rivalLease: unknown = 'not tried';
      const slow = {
        apply: async (input: Parameters<ListApplier['apply']>[0]) => {
          h.clock.advance(RUN_LEASE_MS + 1000);
          const run = await runOf(FRIDAY);
          rivalLease = await h.kit.runs.acquireLease(run?.id ?? '', 'rival');
          return real.apply(input);
        },
      };
      setClock(FRIDAY, HH(6));

      await h.orchestrator({}, { applier: slow as unknown as ListApplier }).tick();

      expect(rivalLease).not.toBeNull();
    });
  });

  // --- reading the history (BR-004-24, BR-004-29) -----------------------------------------------

  describe('what is read back', () => {
    it('"last updated" does not blank while the newest day is applied but not yet completed', async () => {
      await fridayApplied();
      const completed = await h.kit.runs.lastUpdateAt();
      const monday = await h.kit.runs.ensure(MONDAY);
      await h.kit.runs.acquireLease(monday.id, 'w');
      await h.kit.runs.markSuccess(monday.id, 'w', {
        new: 1,
        changed: 0,
        unavailable: 0,
        active: 1,
      });

      expect(await h.kit.runs.lastUpdateAt()).toEqual(completed);
      expect((await h.kit.runs.findOpen()).map((run) => run.brasiliaDate)).toEqual([MONDAY]);

      await h.kit.runs.completeUpdate(monday.id);
      expect(await h.kit.runs.lastUpdateAt()).toEqual(h.clock.now());
    });

    it('alerts are retried for the last two days only: an old unalerted row never emails on a first deploy', async () => {
      const failed = async (day: string) => {
        const run = await h.kit.runs.ensure(day);
        await h.kit.runs.acquireLease(run.id, 'w');
        await h.kit.runs.finalize(run.id, 'w', {
          outcome: 'FAILED',
          reason: 'LIST_UNREACHABLE',
          nonBusinessReason: null,
        });
        await h.kit.runs.releaseLease(run.id, 'w');
      };
      for (const day of ['2026-11-10', '2026-11-20', '2026-11-21', '2026-11-22']) await failed(day);
      setClock(MONDAY, HH(8)); // two days back from Monday: Saturday on

      const candidates = await h.kit.runs.findAlertCandidates();
      expect(candidates.map((run) => run.brasiliaDate).sort()).toEqual([
        '2026-11-21',
        '2026-11-22',
      ]);

      await h.orchestrator().tick();

      expect(h.email.importAlertEmails).toHaveLength(4); // two runs, two admins
      expect((await runOf('2026-11-10'))?.alertedAt).toBeNull();
      expect((await runOf('2026-11-20'))?.alertedAt).toBeNull();
    });
  });

  // --- (ix): the boundaries ----------------------------------------------------------------

  describe('the cutoff boundary (BR-004-03)', () => {
    it('an attempt at the cutoff minus a millisecond is made, at the cutoff it is not', async () => {
      await fridayApplied();
      h.caixa.serveList(FRIDAY_LIST);
      const orchestrator = h.orchestrator();
      setClock(MONDAY, HH(6));
      await orchestrator.tick();
      expect(listRequests()).toBe(1);

      h.clock.set(new Date(brasiliaInstant(MONDAY, HH(12)).getTime() - 1));
      await orchestrator.tick();
      expect(listRequests()).toBe(2);
      expect(await runOf(MONDAY)).toMatchObject({ outcome: 'RUNNING', attempts: 2 });

      setClock(MONDAY, HH(12));
      await orchestrator.tick();
      expect(listRequests()).toBe(2);
      expect(await runOf(MONDAY)).toMatchObject({ outcome: 'NO_NEW_LIST', attempts: 2 });
    });

    it('with the settings changed: a later window, fewer attempts, a longer spacing', async () => {
      const orchestrator = h.orchestrator({
        IMPORT_WINDOW_START: '08:00',
        IMPORT_CUTOFF: '09:00',
        IMPORT_MAX_ATTEMPTS: '2',
        IMPORT_ATTEMPT_SPACING_MINUTES: '20',
      });
      h.caixa.serveList(new CaixaUnreachableError('TIMEOUT'));

      await tickThrough(orchestrator, FRIDAY, HH(7), HH(10));

      // 08:00 and 08:20 are the attempts; the second uses them up: decided at once, FAILED.
      expect(listRequests()).toBe(2);
      expect(await runOf(FRIDAY)).toMatchObject({
        outcome: 'FAILED',
        attempts: 2,
        finishedAt: brasiliaInstant(FRIDAY, HH(8, 20)),
      });
    });
  });

  // --- (xi): alerts that cannot be sent ------------------------------------------------------

  describe('an alert that cannot be sent (BR-004-29)', () => {
    it('releases the claim, never fails the run, and the next tick sends it', async () => {
      await fridayApplied();
      h.caixa.serveList(FRIDAY_LIST);
      const orchestrator = h.orchestrator();
      await tickThrough(orchestrator, MONDAY, HH(6), HH(11, 55));
      h.email.failAll = true;

      setClock(MONDAY, HH(12));
      await orchestrator.tick();

      expect(await runOf(MONDAY)).toMatchObject({ outcome: 'NO_NEW_LIST', alertedAt: null });
      expect(h.email.importAlertEmails).toHaveLength(0);

      h.email.failAll = false;
      setClock(MONDAY, HH(12, 5));
      await orchestrator.tick();

      expect((await runOf(MONDAY))?.alertedAt).toEqual(brasiliaInstant(MONDAY, HH(12, 5)));
      expect(h.email.importAlertEmails).toHaveLength(2);
      await orchestrator.tick();
      expect(h.email.importAlertEmails).toHaveLength(2);
    });

    it('one admin failing does not stop the others, and the claim is kept once somebody was told', async () => {
      await fridayApplied();
      h.caixa.serveList(FRIDAY_LIST);
      h.email.failFor.add('admin.um@example.test');

      await tickThrough(h.orchestrator(), MONDAY, HH(6), HH(12));
      await tickThrough(h.orchestrator(), MONDAY, HH(12, 5), HH(12, 15));

      expect(h.email.importAlertEmails.map((mail) => mail.email)).toEqual([
        'admin.dois@example.test',
      ]);
      expect((await runOf(MONDAY))?.alertedAt).not.toBeNull();
    });

    it('no admin to tell: the claim is released and tried again each tick', async () => {
      await fridayApplied();
      h.caixa.serveList(FRIDAY_LIST);
      h.admins.length = 0;
      const orchestrator = h.orchestrator();

      await tickThrough(orchestrator, MONDAY, HH(6), HH(12, 10));
      expect((await runOf(MONDAY))?.alertedAt).toBeNull();

      h.admins.push('admin.tres@example.test');
      setClock(MONDAY, HH(12, 15));
      await orchestrator.tick();

      expect(h.email.importAlertEmails.map((mail) => mail.email)).toEqual([
        'admin.tres@example.test',
      ]);
    });
  });

  // --- the dev tick --------------------------------------------------------------------------

  describe('the forced startup tick (IMPORT_ON_START_UP)', () => {
    it('makes one attempt outside the window, and leaves a decided run alone', async () => {
      const orchestrator = h.orchestrator();
      setClock(MONDAY, HH(15));

      await orchestrator.tick({ force: true });

      expect(listRequests()).toBe(1);
      expect(await runOf(MONDAY)).toMatchObject({ attempts: 1, outcome: 'SUCCESS' });
      expect(h.health.recordExecution).toHaveBeenCalledWith('auctions-import', 'MANUAL');

      await orchestrator.tick({ force: true });
      expect(listRequests()).toBe(1);
    });

    it('makes at most ONE request however the day stands: the force is spent on the first step', async () => {
      await fridayApplied();
      h.caixa.serveList(FRIDAY_LIST); // not new
      setClock(MONDAY, HH(15)); // past the cutoff

      await h.orchestrator().tick({ force: true });

      expect(listRequests()).toBe(1);
      expect(await runOf(MONDAY)).toMatchObject({ outcome: 'NO_NEW_LIST', attempts: 1 });
      expect(h.health.recordFailure).toHaveBeenCalledWith(
        'auctions-import',
        'MANUAL',
        'NO_NEW_LIST',
      );
    });

    it('a blocked forced attempt is recorded with its own run mode, not AUTO', async () => {
      h.caixa.serveList(new CaixaBlockedError('HTTP_429'));
      setClock(MONDAY, HH(15));

      await h.orchestrator().tick({ force: true });

      expect(h.health.recordFailure).toHaveBeenCalledWith(
        'auctions-import',
        'MANUAL',
        'LIST_BLOCKED',
      );
    });

    it('keys the day by Brasília, whatever the host zone: 23:30 Brasília is already the next day in UTC', async () => {
      const previous = process.env['TZ'];
      process.env['TZ'] = 'UTC';
      try {
        h.clock.set(new Date('2026-11-24T02:30:00.000Z')); // Monday 23:30 in Brasília
        h.caixa.serveList(MONDAY_LIST);

        await h.orchestrator().tick({ force: true });

        expect(await runOf(MONDAY)).toMatchObject({ outcome: 'SUCCESS', brasiliaDate: MONDAY });
        expect(await runOf(TUESDAY)).toBeNull();
      } finally {
        if (previous === undefined) delete process.env['TZ'];
        else process.env['TZ'] = previous;
      }
    });
  });
});

/** Polls until `check` is true (a worker that started in the background has got where it stalls). */
async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 5_000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeoutMs)
      throw new Error('waited too long for the background worker');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
