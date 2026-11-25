// The import job end to end below the network: a (hand-made, fake) Caixa list goes through the
// real parser, and the spec reads what the importer hands to AuctionsService and what it records.
// TS-07: the list comes from a fake CsvCacheService; AuctionsService is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuctionsImporter, STARTUP_IMPORT_DELAY_MS } from './scheduler.js';
import { AUCTIONS_IMPORT_JOB } from './import-job.js';
import { PhaseModality } from '../schemas/auction.schema.js';
import { FakeClock } from '../../../test/fakes/fake-clock.js';
import { RunMode } from '../../common/job-execution.js';
import { spyOnLogger } from '../../../test/support/logger-spy.js';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

type Deps = ConstructorParameters<typeof AuctionsImporter>;

const HEADER =
  ' Lista de Imóveis da Caixa;;Data de geração:;10/11/2025;;;;;;;\n' +
  ' N° do imóvel;UF;Cidade;Bairro;Endereço;Preço;Valor de avaliação;Desconto;Descrição;Modalidade de venda;Link de acesso\n\n';

/** One list row; the details link carries the property number, as on Caixa's site. */
function row(code: string, modality: string, price = '100.000,50', appraisal = '200.000,00') {
  return (
    ` ${code} ;SP ;CAMPINAS ;CENTRO ; RUA A, N. 1 ;${price};${appraisal};50.00;Casa;${modality};` +
    `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=${code}\n`
  );
}

const COUNTS = { new: 1, changed: 2, unavailable: 3, active: 4 };

function build(
  csv: string | Error,
  opts: {
    enabled?: boolean;
    onStartup?: boolean;
    ranRecently?: boolean;
    today?: { outcome: string } | null;
    lastApplied?: { generatedOn: string; rowCount: number } | null;
    begin?: { id: string } | null;
    applyFails?: boolean;
    marked?: boolean;
    cacheFails?: boolean;
    recordFails?: boolean;
  } = {},
) {
  const auctions = {
    invalidateNeighborhoodsCache: vi.fn(() =>
      opts.cacheFails ? Promise.reject(new TypeError('cache down')) : Promise.resolve(undefined),
    ),
  };
  const jobExecutions = {
    hasRunRecently: vi.fn().mockResolvedValue(opts.ranRecently ?? false),
    recordExecution: vi.fn(() =>
      opts.recordFails ? Promise.reject(new TypeError('db down')) : Promise.resolve(undefined),
    ),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const csvCache = {
    resolveCsv: vi.fn(() => (csv instanceof Error ? Promise.reject(csv) : Promise.resolve(csv))),
  };
  const importRuns = {
    findByDate: vi.fn().mockResolvedValue(opts.today ?? null),
    lastAppliedList: vi.fn().mockResolvedValue(opts.lastApplied ?? null),
    begin: vi.fn().mockResolvedValue(opts.begin === undefined ? { id: 'run-1' } : opts.begin),
    recordWithoutApply: vi.fn().mockResolvedValue(null),
    markSuccess: vi.fn().mockResolvedValue(opts.marked ?? true),
    markFailed: vi.fn().mockResolvedValue(true),
  };
  const applier = {
    apply: vi.fn(() =>
      opts.applyFails ? Promise.reject(new TypeError('boom')) : Promise.resolve(COUNTS),
    ),
  };
  const importer = new AuctionsImporter(
    auctions as unknown as Deps[0],
    jobExecutions as unknown as Deps[1],
    csvCache as unknown as Deps[2],
    { import: { enabled: opts.enabled ?? true, onStartup: opts.onStartup ?? false } } as Deps[3],
    importRuns as unknown as Deps[4],
    applier as unknown as Deps[5],
    new FakeClock(new Date('2025-11-10T15:00:00.000Z')), // 12:00 on 2025-11-10 in Brasília
    { import: { minRowRatio: 0.8 } } as Deps[7],
  );
  return { importer, auctions, jobExecutions, csvCache, importRuns, applier };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AuctionsImporter.onModuleInit', () => {
  it('does nothing but say so when IMPORT_ENABLED is off', async () => {
    const logger = spyOnLogger();
    const { importer, csvCache } = build(HEADER, { enabled: false, onStartup: true });

    await importer.onModuleInit();
    await vi.advanceTimersByTimeAsync(STARTUP_IMPORT_DELAY_MS * 2);

    expect(logger.loggedText()).toContain('Import is disabled');
    expect(csvCache.resolveCsv).not.toHaveBeenCalled();
  });

  it('only waits for the schedule when IMPORT_ON_START_UP is off', async () => {
    const logger = spyOnLogger();
    const { importer, csvCache } = build(HEADER, { onStartup: false });

    await importer.onModuleInit();
    await vi.advanceTimersByTimeAsync(STARTUP_IMPORT_DELAY_MS * 2);

    expect(logger.loggedText()).toContain('Skipping startup import');
    expect(csvCache.resolveCsv).not.toHaveBeenCalled();
  });

  it('runs a manual import once the startup delay has passed', async () => {
    const { importer, csvCache, jobExecutions } = build(HEADER + row('1', 'Venda Online'), {
      onStartup: true,
    });

    await importer.onModuleInit();
    await vi.advanceTimersByTimeAsync(STARTUP_IMPORT_DELAY_MS - 1);
    expect(csvCache.resolveCsv).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(csvCache.resolveCsv).toHaveBeenCalledTimes(1);
    expect(jobExecutions.recordExecution).toHaveBeenCalledWith(AUCTIONS_IMPORT_JOB, RunMode.MANUAL);
  });
});

describe('AuctionsImporter.dailyJob', () => {
  it('is skipped when IMPORT_ENABLED is off', async () => {
    const { importer, jobExecutions, csvCache } = build(HEADER, { enabled: false });

    await importer.dailyJob();

    expect(jobExecutions.hasRunRecently).not.toHaveBeenCalled();
    expect(csvCache.resolveCsv).not.toHaveBeenCalled();
  });

  it("does not consult the 23-hour jobexecutions guard: only today's Import Run decides (BR-004-07)", async () => {
    // The health record says a run succeeded an hour ago (yesterday's 23:50, say): today is a new day.
    const { importer, jobExecutions, importRuns, csvCache } = build(
      HEADER + row('1', 'Venda Online'),
      {
        ranRecently: true,
      },
    );

    await importer.dailyJob();

    expect(jobExecutions.hasRunRecently).not.toHaveBeenCalled();
    expect(importRuns.findByDate).toHaveBeenCalledWith('2025-11-10');
    expect(csvCache.resolveCsv).toHaveBeenCalledTimes(1);
  });

  it("applies a valid list: begins the day's run, hands the rows to the applier, records the counts", async () => {
    const csv =
      HEADER +
      row('111', 'Venda Online') +
      row('222', 'Leilão SFI - Edital único') +
      row('333', 'Venda Direta Online', '', '90.000,00') +
      row('444', 'Licitação Aberta');
    const { importer, auctions, jobExecutions, importRuns, applier } = build(csv);

    await importer.dailyJob();

    // BR-004-02: the list's own generation day, and the day of the run in Brasília.
    expect(importRuns.findByDate).toHaveBeenCalledWith('2025-11-10');
    expect(importRuns.begin).toHaveBeenCalledWith('2025-11-10', {
      generatedOn: '2025-11-10',
      rows: 4,
    });
    const [input] = applier.apply.mock.calls[0] as unknown as [
      { runId: string; rows: Record<string, unknown>[] },
    ];
    expect(input.runId).toBe('run-1');
    // The guard of the sweep (BR-004-08) is told the configured ratio.
    expect(applier.apply).toHaveBeenCalledWith(expect.objectContaining({ minRowRatio: 0.8 }));
    expect(input.rows.map((r) => [r['code'], r['modality']])).toEqual([
      ['111', PhaseModality.ONLINE_SALES],
      ['222', PhaseModality.SFI_AUCTION],
      ['333', PhaseModality.DIRECT_ONLINE_SALES],
      ['444', PhaseModality.OPEN_BIDDING],
    ]);
    // The first row: price 100.000,50 is R$ 100000.50 as a Decimal (AR-17).
    expect(String(input.rows[0]?.['minimumPrice'])).toBe('100000.5');
    expect(String(input.rows[0]?.['appraisalPrice'])).toBe('200000');
    expect(input.rows[0]?.['address']).toEqual({
      street: expect.any(String),
      neighborhood: 'CENTRO',
      city: 'CAMPINAS',
      state: 'SP',
    });
    // An empty price cell is "no price", not zero.
    expect(input.rows[2]?.['minimumPrice']).toBeNull();

    expect(importRuns.markSuccess).toHaveBeenCalledWith('run-1', COUNTS);
    expect(auctions.invalidateNeighborhoodsCache).toHaveBeenCalledTimes(1);
    expect(jobExecutions.recordExecution).toHaveBeenCalledWith(AUCTIONS_IMPORT_JOB, RunMode.AUTO);
  });

  it('keeps a listed row whose modality is unknown, with a null modality, and says so', async () => {
    const logger = spyOnLogger();
    const { importer, applier } = build(HEADER + row('111', 'Modalidade Nova'));

    await importer.dailyJob();

    const [input] = applier.apply.mock.calls[0] as unknown as [{ rows: unknown[] }];
    expect(input.rows).toEqual([expect.objectContaining({ code: '111', modality: null })]);
    expect(logger.loggedText()).toContain('unknown modality: 1');
  });

  it('BR-004-10: a truncated list is recorded REJECTED_LIST and applies nothing', async () => {
    const logger = spyOnLogger();
    const { importer, importRuns, applier, jobExecutions } = build(
      HEADER + row('111', 'Venda Online'),
      { lastApplied: { generatedOn: '2025-11-09', rowCount: 10 } },
    );

    await importer.dailyJob();

    expect(importRuns.recordWithoutApply).toHaveBeenCalledWith(
      '2025-11-10',
      'REJECTED_LIST',
      'TRUNCATED_LIST',
      { generatedOn: '2025-11-10', rows: 1 },
    );
    expect(importRuns.begin).not.toHaveBeenCalled();
    expect(applier.apply).not.toHaveBeenCalled();
    expect(jobExecutions.recordFailure).toHaveBeenCalledWith(
      AUCTIONS_IMPORT_JOB,
      RunMode.AUTO,
      'LIST_REJECTED',
    );
    expect(jobExecutions.recordExecution).not.toHaveBeenCalled();
    expect(logger.loggedText()).toContain('REJECTED_LIST TRUNCATED_LIST');
    expect(logger.loggedText()).not.toContain('CAMPINAS'); // SC-15: no row content
  });

  it('BR-004-10: a list that is not newer is recorded NO_NEW_LIST and applies nothing', async () => {
    const { importer, importRuns, applier, jobExecutions } = build(
      HEADER + row('111', 'Venda Online'),
      { lastApplied: { generatedOn: '2025-11-10', rowCount: 1 } },
    );

    await importer.dailyJob();

    expect(importRuns.recordWithoutApply).toHaveBeenCalledWith(
      '2025-11-10',
      'NO_NEW_LIST',
      'NO_NEW_LIST',
      { generatedOn: '2025-11-10', rows: 1 },
    );
    expect(applier.apply).not.toHaveBeenCalled();
    expect(jobExecutions.recordFailure).toHaveBeenCalledWith(
      AUCTIONS_IMPORT_JOB,
      RunMode.AUTO,
      'NO_NEW_LIST',
    );
  });

  it('BR-004-04: a list with no rows is rejected, never applied (it would hide the catalogue)', async () => {
    const { importer, importRuns, applier } = build(HEADER);

    await importer.dailyJob();

    expect(importRuns.recordWithoutApply).toHaveBeenCalledWith(
      '2025-11-10',
      'REJECTED_LIST',
      'EMPTY_LIST',
      { generatedOn: '2025-11-10', rows: 0 },
    );
    expect(applier.apply).not.toHaveBeenCalled();
  });

  it("does not even download when today's Import Run already succeeded", async () => {
    const { importer, csvCache, importRuns } = build(HEADER, { today: { outcome: 'SUCCESS' } });

    await importer.dailyJob();

    expect(csvCache.resolveCsv).not.toHaveBeenCalled();
    expect(importRuns.begin).not.toHaveBeenCalled();
  });

  it('applies nothing when another attempt just finished the day (begin answers none)', async () => {
    const { importer, applier, jobExecutions } = build(HEADER + row('111', 'Venda Online'), {
      begin: null,
    });

    await importer.dailyJob();

    expect(applier.apply).not.toHaveBeenCalled();
    expect(jobExecutions.recordExecution).not.toHaveBeenCalled();
  });

  it('marks the run FAILED with the error class when the apply fails, and rethrows', async () => {
    const { importer, importRuns, jobExecutions } = build(HEADER + row('111', 'Venda Online'), {
      applyFails: true,
    });

    await expect(importer.dailyJob()).rejects.toBeInstanceOf(TypeError);

    expect(importRuns.markFailed).toHaveBeenCalledWith('run-1', 'TypeError');
    expect(importRuns.markSuccess).not.toHaveBeenCalled();
    expect(jobExecutions.recordFailure).toHaveBeenCalledWith(
      AUCTIONS_IMPORT_JOB,
      RunMode.AUTO,
      'TypeError',
    );
  });

  describe('after the list was applied (BR-004-07, AR-48)', () => {
    const csv = HEADER + row('111', 'Venda Online');

    it('a cache that cannot be invalidated does not fail the run or the health record', async () => {
      const logger = spyOnLogger();
      const { importer, importRuns, jobExecutions } = build(csv, { cacheFails: true });

      await expect(importer.dailyJob()).resolves.toBeUndefined();

      expect(importRuns.markFailed).not.toHaveBeenCalled();
      expect(jobExecutions.recordFailure).not.toHaveBeenCalled();
      expect(jobExecutions.recordExecution).toHaveBeenCalledTimes(1);
      expect(logger.loggedText()).toContain(
        'Could not invalidate the neighborhoods cache: TypeError',
      );
      expect(logger.loggedText()).not.toContain('cache down'); // SC-15: the code, not the message
    });

    it('a health record that cannot be written does not fail the run either', async () => {
      const logger = spyOnLogger();
      const { importer, importRuns, jobExecutions } = build(csv, { recordFails: true });

      await expect(importer.dailyJob()).resolves.toBeUndefined();

      expect(importRuns.markSuccess).toHaveBeenCalledTimes(1);
      expect(importRuns.markFailed).not.toHaveBeenCalled();
      expect(jobExecutions.recordFailure).not.toHaveBeenCalled();
      expect(logger.loggedText()).toContain('Could not record the successful import: TypeError');
    });

    it('a run another attempt already finished is not an error: the apply was idempotent', async () => {
      const { importer, importRuns, jobExecutions } = build(csv, { marked: false });

      await expect(importer.dailyJob()).resolves.toBeUndefined();

      expect(importRuns.markFailed).not.toHaveBeenCalled();
      expect(jobExecutions.recordExecution).toHaveBeenCalledTimes(1);
    });
  });
});
