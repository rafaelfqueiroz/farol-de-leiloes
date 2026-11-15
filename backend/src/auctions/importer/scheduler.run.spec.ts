// The import job end to end below the network: a (hand-made, fake) Caixa list goes through the
// real parser, and the spec reads what the importer hands to AuctionsService and what it records.
// TS-07: the list comes from a fake CsvCacheService; AuctionsService is a stub.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuctionsImporter, STARTUP_IMPORT_DELAY_MS } from './scheduler.js';
import { AUCTIONS_IMPORT_JOB } from './import-job.js';
import { PhaseModality } from '../schemas/auction.schema.js';
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

function build(
  csv: string | Error,
  opts: { enabled?: boolean; onStartup?: boolean; ranRecently?: boolean } = {},
) {
  const auctions = {
    upsertMany: vi.fn().mockResolvedValue({ matched: 1, upserted: 2, modified: 3 }),
    markAvailable: vi.fn().mockResolvedValue(4),
    verifyAvailability: vi.fn().mockResolvedValue({ checked: 5, unavailable: 1, errors: 0 }),
    invalidateNeighborhoodsCache: vi.fn().mockResolvedValue(undefined),
  };
  const jobExecutions = {
    hasRunRecently: vi.fn().mockResolvedValue(opts.ranRecently ?? false),
    recordExecution: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const csvCache = {
    resolveCsv: vi.fn(() => (csv instanceof Error ? Promise.reject(csv) : Promise.resolve(csv))),
  };
  const importer = new AuctionsImporter(
    auctions as unknown as Deps[0],
    jobExecutions as unknown as Deps[1],
    csvCache as unknown as Deps[2],
    { import: { enabled: opts.enabled ?? true, onStartup: opts.onStartup ?? false } } as Deps[3],
  );
  return { importer, auctions, jobExecutions, csvCache };
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

  it('is skipped when a run succeeded within 23 hours', async () => {
    const { importer, jobExecutions, csvCache } = build(HEADER, { ranRecently: true });

    await importer.dailyJob();

    expect(jobExecutions.hasRunRecently).toHaveBeenCalledWith(
      AUCTIONS_IMPORT_JOB,
      RunMode.AUTO,
      23,
    );
    expect(csvCache.resolveCsv).not.toHaveBeenCalled();
  });

  it('upserts every row with its phase, then restores, verifies and records the run', async () => {
    const csv =
      HEADER +
      row('111', 'Venda Online') +
      row('222', 'Leilão SFI - Edital único') +
      row('333', 'Venda Direta Online', '', '90.000,00') +
      row('444', 'Licitação Aberta');
    const { importer, auctions, jobExecutions } = build(csv);

    await importer.dailyJob();

    const [items] = auctions.upsertMany.mock.calls[0] as [
      {
        code: string;
        phases: { modality: PhaseModality; minimumPrice: unknown; phaseDates: Date[] }[];
        address: Record<string, string | undefined>;
        appraisalPrice?: { toString(): string };
        detailsUrl?: string;
      }[],
    ];
    expect(items.map((i) => [i.code, i.phases.map((p) => p.modality)])).toEqual([
      ['111', [PhaseModality.ONLINE_SALES]],
      ['222', [PhaseModality.SFI_AUCTION]],
      ['333', [PhaseModality.DIRECT_ONLINE_SALES]],
      ['444', [PhaseModality.OPEN_BIDDING]],
    ]);
    // The first row: price 100.000,50 is R$ 100000.50 as a Decimal (AR-17); dates come later.
    expect(items[0]?.phases[0]?.minimumPrice?.toString()).toBe('100000.5');
    expect(items[0]?.phases[0]?.phaseDates).toEqual([]);
    expect(items[0]?.appraisalPrice?.toString()).toBe('200000');
    expect(items[0]?.address).toEqual({
      street: expect.any(String),
      neighborhood: 'CENTRO',
      city: 'CAMPINAS',
      state: 'SP',
    });
    expect(items[0]?.detailsUrl).toContain('hdnimovel=111');
    // An empty price cell is "no price", not zero.
    expect(items[2]?.phases[0]?.minimumPrice).toBeNull();

    expect(auctions.markAvailable).toHaveBeenCalledWith(['111', '222', '333', '444']);
    expect(auctions.verifyAvailability).toHaveBeenCalledWith(['111', '222', '333', '444']);
    expect(auctions.invalidateNeighborhoodsCache).toHaveBeenCalledTimes(1);
    expect(jobExecutions.recordExecution).toHaveBeenCalledWith(AUCTIONS_IMPORT_JOB, RunMode.AUTO);
  });

  it('keeps an auction whose modality is unknown, with no phase, and says so', async () => {
    const logger = spyOnLogger();
    const { importer, auctions } = build(HEADER + row('111', 'Modalidade Nova'));

    await importer.dailyJob();

    const [items] = auctions.upsertMany.mock.calls[0] as [{ code: string; phases: unknown[] }[]];
    expect(items).toEqual([expect.objectContaining({ code: '111', phases: [] })]);
    expect(logger.loggedText()).toContain('Items with unknown modality: 1');
    expect(logger.loggedText()).toContain('Items with phases: 0, without phases: 1');
  });

  it('does not check availability against an empty list: the whole catalogue would look gone', async () => {
    const logger = spyOnLogger();
    const { importer, auctions, jobExecutions } = build(HEADER);

    await importer.dailyJob();

    expect(auctions.upsertMany).toHaveBeenCalledWith([]);
    expect(auctions.markAvailable).not.toHaveBeenCalled();
    expect(auctions.verifyAvailability).not.toHaveBeenCalled();
    expect(logger.loggedText()).toContain('Skipping availability check');
    expect(jobExecutions.recordExecution).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Leilão SFI', PhaseModality.SFI_AUCTION],
    ['Edital Único', PhaseModality.SFI_AUCTION],
    ['EDITAL UNICO', PhaseModality.SFI_AUCTION],
    ['Leilao', PhaseModality.SFI_AUCTION],
    ['Licitacao', PhaseModality.OPEN_BIDDING],
    ['Venda Direta', PhaseModality.DIRECT_ONLINE_SALES],
    ['Venda Online', PhaseModality.ONLINE_SALES],
  ])('maps the modality "%s" to %s', (modality, expected) => {
    const { importer } = build(HEADER);
    expect(importer['mapModalityToPhase'](modality)).toBe(expected);
  });

  it('does not map a modality it does not know', () => {
    expect(build(HEADER).importer['mapModalityToPhase']('Concorrência')).toBeNull();
  });
});
