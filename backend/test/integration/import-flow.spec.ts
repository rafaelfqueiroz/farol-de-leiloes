// SPEC-004 BR-004-02, BR-004-04, BR-004-10, BR-004-27: the single-attempt import end to end below the
// network: a hand-made Caixa list goes through the real parser, validator, ListApplier and Import
// Run services on a real MongoDB (Testcontainers). Only the list source, the clock and the health
// record are fakes (TS-06, TS-07): Caixa is never reached.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuctionsImporter } from '../../src/auctions/importer/scheduler.js';
import { ListApplier } from '../../src/auctions/importer/list-applier.service.js';
import { ListApplierRepository } from '../../src/auctions/importer/list-applier.repository.js';
import { AUCTIONS_IMPORT_JOB } from '../../src/auctions/importer/import-job.js';
import { AuctionEntity, AuctionSchema } from '../../src/auctions/schemas/auction.schema.js';
import {
  ImportRunEntity,
  ImportRunSchema,
} from '../../src/auctions/import-runs/import-run.schema.js';
import {
  PropertyChangeEntity,
  PropertyChangeSchema,
} from '../../src/auctions/changes/property-change.schema.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { DAY, FakeClock } from '../fakes/fake-clock.js';
import { readCaixaFixture } from '../support/fixtures.js';
import { type ImportKit, importKit } from '../support/list-applier.js';
import { useTestDatabase } from '../support/test-database.js';

vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

// 12:00 on 2025-11-10 in Brasília (UTC-3).
const DAY_ONE = new Date('2025-11-10T15:00:00.000Z');

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

describe('the import flow (integration)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let kit: ImportKit;
  const clock = new FakeClock(DAY_ONE);
  let csv: string;
  const jobExecutions = {
    recordExecution: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
    hasRunRecently: vi.fn().mockResolvedValue(false),
  };
  const csvCache = { resolveCsv: vi.fn(() => Promise.resolve(csv)) };
  const neighborhoods = { invalidateNeighborhoodsCache: vi.fn().mockResolvedValue(undefined) };

  function importer(applier: ListApplier = kit.applier) {
    return new AuctionsImporter(
      neighborhoods as never,
      jobExecutions as never,
      csvCache as never,
      { import: { enabled: true, onStartup: false } } as never,
      kit.runs,
      applier,
      clock,
      { import: { minRowRatio: 0.8 } } as never,
    );
  }

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
    await kit.runModel.syncIndexes();
    await kit.changeModel.syncIndexes();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    clock.set(DAY_ONE);
    await kit.auctionModel.deleteMany({});
    await kit.changeModel.deleteMany({});
    await kit.runModel.deleteMany({});
    vi.clearAllMocks();
  });

  /** Everything a run must not touch when it applies nothing. */
  async function snapshot() {
    return {
      auctions: await kit.auctionModel.collection.find({}).sort({ code: 1 }).toArray(),
      changes: await kit.changeModel.countDocuments(),
    };
  }
  const runOf = (day: string) => kit.runs.findByDate(day);

  async function dayOneSucceeds() {
    csv = list('10/11/2025', TEN);
    await importer().dailyJob();
  }

  it('a valid list is applied and its Import Run is SUCCESS with the counts (BR-004-27)', async () => {
    csv = list('10/11/2025', TEN);

    await importer().dailyJob();

    expect(await runOf('2025-11-10')).toMatchObject({
      outcome: 'SUCCESS',
      brasiliaDate: '2025-11-10',
      listGeneratedAt: '2025-11-10',
      listRows: 10,
      attempts: 1,
      counts: { new: 10, changed: 0, unavailable: 0, active: 10 },
      startedAt: DAY_ONE,
      finishedAt: DAY_ONE,
      failureReasons: [],
    });
    expect(await kit.auctionModel.countDocuments({ available: true })).toBe(10);
    expect(jobExecutions.recordExecution).toHaveBeenCalledWith(AUCTIONS_IMPORT_JOB, 'AUTO');
    expect(await kit.runs.lastAppliedList()).toEqual({ generatedOn: '2025-11-10', rowCount: 10 });
  });

  it('BR-004-04, BR-004-10: a truncated list (30% of the rows) is REJECTED_LIST with zero writes', async () => {
    await dayOneSucceeds();
    clock.advance(DAY);
    const before = await snapshot();
    csv = list('11/11/2025', TEN.slice(0, 3));

    await importer().dailyJob();

    expect(await snapshot()).toEqual(before); // no property touched, no change entry written
    expect(await kit.auctionModel.countDocuments({ available: false })).toBe(0);
    expect(await runOf('2025-11-11')).toMatchObject({
      outcome: 'REJECTED_LIST',
      listGeneratedAt: '2025-11-11',
      listRows: 3,
      failureReasons: ['TRUNCATED_LIST'],
    });
    // "Last updated" does not move: the last applied list is still day one's (BR-004-10, BR-004-24).
    expect(await kit.runs.lastAppliedList()).toEqual({ generatedOn: '2025-11-10', rowCount: 10 });
    expect(jobExecutions.recordFailure).toHaveBeenCalledWith(
      AUCTIONS_IMPORT_JOB,
      'AUTO',
      'LIST_REJECTED',
    );
  });

  it('BR-004-04: a list with an unrecognised layout is rejected the same way', async () => {
    await dayOneSucceeds();
    clock.advance(DAY);
    const before = await snapshot();
    csv = readCaixaFixture('lista-unrecognised-layout.csv');

    await importer().dailyJob();

    expect(await snapshot()).toEqual(before);
    expect(await runOf('2025-11-11')).toMatchObject({
      outcome: 'REJECTED_LIST',
      failureReasons: ['UNRECOGNISED_LAYOUT'],
    });
  });

  it('BR-004-02, BR-004-10: a list not newer than the last applied is NO_NEW_LIST with zero writes', async () => {
    await dayOneSucceeds();
    clock.advance(DAY);
    const before = await snapshot();
    csv = list('10/11/2025', TEN.slice(0, 9)); // yesterday's generation date again

    await importer().dailyJob();

    expect(await snapshot()).toEqual(before);
    expect(await runOf('2025-11-11')).toMatchObject({
      outcome: 'NO_NEW_LIST',
      failureReasons: ['NO_NEW_LIST'],
    });
  });

  it('BR-004-10: a failed apply is FAILED with a code, hides nothing, and the retry the same day completes it', async () => {
    await dayOneSucceeds();
    clock.advance(DAY);
    const before = await snapshot();
    class Dying extends ListApplierRepository {
      override applyChunk(): Promise<void> {
        return Promise.reject(new TypeError('the database went away'));
      }
    }
    const dying = new ListApplier(new Dying(kit.auctionModel), kit.changes, clock);
    csv = list('11/11/2025', [...TEN.slice(0, 9), ['2000', 'Venda Online', '50.000,00']]);

    await expect(importer(dying).dailyJob()).rejects.toBeInstanceOf(TypeError);

    expect(await runOf('2025-11-11')).toMatchObject({
      outcome: 'FAILED',
      failureReasons: ['TypeError'], // the class, never the message (SC-15)
      attempts: 1,
    });
    // The properties are as the last successful run left them: none hidden, none changed.
    expect((await snapshot()).auctions).toEqual(before.auctions);
    expect(await kit.auctionModel.countDocuments({ available: false })).toBe(0);
    expect(await kit.runs.lastAppliedList()).toEqual({ generatedOn: '2025-11-10', rowCount: 10 });
    expect(jobExecutions.recordFailure).toHaveBeenCalledWith(
      AUCTIONS_IMPORT_JOB,
      'AUTO',
      'TypeError',
    );

    // The next attempt of the day reuses the day's row and ends it SUCCESS (BR-004-07).
    await importer().dailyJob();

    expect(await runOf('2025-11-11')).toMatchObject({
      outcome: 'SUCCESS',
      attempts: 2,
      counts: { new: 1, changed: 0, unavailable: 1, active: 10 },
    });
    expect(await kit.runModel.countDocuments({ brasiliaDate: '2025-11-11' })).toBe(1);
  });

  it('a day that already succeeded is not downloaded or applied again', async () => {
    await dayOneSucceeds();
    csvCache.resolveCsv.mockClear();

    await importer().dailyJob();

    expect(csvCache.resolveCsv).not.toHaveBeenCalled();
    expect(await runOf('2025-11-10')).toMatchObject({ outcome: 'SUCCESS', attempts: 1 });
  });

  it('a download that fails is a FAILED day with the error class, previous data untouched', async () => {
    await dayOneSucceeds();
    clock.advance(DAY);
    const before = await snapshot();
    class DownloadError extends Error {
      override name = 'DownloadError';
    }
    csvCache.resolveCsv.mockRejectedValueOnce(new DownloadError('403 for x'));

    await expect(importer().dailyJob()).rejects.toBeInstanceOf(DownloadError);

    expect(await snapshot()).toEqual(before);
    expect(await runOf('2025-11-11')).toMatchObject({
      outcome: 'FAILED',
      failureReasons: ['DownloadError'],
    });
  });

  it('a later attempt of a rejected day applies a valid list and ends it SUCCESS', async () => {
    await dayOneSucceeds();
    clock.advance(DAY);
    csv = list('11/11/2025', TEN.slice(0, 3));
    await importer().dailyJob();
    expect((await runOf('2025-11-11'))?.outcome).toBe('REJECTED_LIST');

    csv = list('11/11/2025', TEN);
    await importer().dailyJob();

    expect(await runOf('2025-11-11')).toMatchObject({
      outcome: 'SUCCESS',
      attempts: 2,
      counts: { new: 0, changed: 0, unavailable: 0, active: 10 },
    });
  });
});
