// SPEC-004 parts 3 and 4: the real dependency graph of AuctionsModule resolves (the orchestrator,
// the alert service, the run service, the signal bus, the detail collection with its rate gate
// inputs, the round clock and the two controllers), and the enrichment seam is the real pass.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuctionsModule } from '../../src/auctions/auctions.module.js';
import { AuctionsImporter } from '../../src/auctions/importer/scheduler.js';
import { ImportOrchestrator } from '../../src/auctions/importer/import-orchestrator.service.js';
import { ImportAlertService } from '../../src/auctions/import-runs/import-alert.service.js';
import { DailyUpdateBus } from '../../src/auctions/import-runs/daily-update-bus.js';
import { EnrichmentPass } from '../../src/auctions/enrichment/enrichment-pass.js';
import { DetailEnrichmentPass } from '../../src/auctions/enrichment/detail-enrichment-pass.js';
import { RoundClockService } from '../../src/auctions/enrichment/round-clock.service.js';
import { Sleeper, SystemSleeper } from '../../src/common/clock/sleeper.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { useTestDatabase } from '../support/test-database.js';
import { testEnv } from '../support/test-env.js';

describe('AuctionsModule wiring (SPEC-004 part 3)', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: () => testEnv() }),
        MongooseModule.forRoot(db.uri),
        AuctionsModule,
      ],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('resolves the import job, the orchestrator, the alerts and the signal', () => {
    expect(moduleRef.get(AuctionsImporter)).toBeInstanceOf(AuctionsImporter);
    expect(moduleRef.get(ImportOrchestrator)).toBeInstanceOf(ImportOrchestrator);
    expect(moduleRef.get(ImportAlertService)).toBeInstanceOf(ImportAlertService);
    expect(moduleRef.get(DailyUpdateBus)).toBeInstanceOf(DailyUpdateBus);
  });

  it('provides the real detail collection, the round clock and the real sleeper (SC-24)', () => {
    expect(moduleRef.get(EnrichmentPass)).toBeInstanceOf(DetailEnrichmentPass);
    expect(moduleRef.get(RoundClockService)).toBeInstanceOf(RoundClockService);
    expect(moduleRef.get(Sleeper)).toBeInstanceOf(SystemSleeper);
  });

  it('collects nothing from an empty catalogue, whatever SCRAPER_ENABLED says, and asks Caixa nothing', async () => {
    const pass = moduleRef.get(EnrichmentPass);
    const previous = { collected: 0, failed: 0, blocked: false, pages: 0, requests: 0 };

    const result = await pass.run({
      importRunId: '0123456789abcdef01234567',
      brasiliaDate: '2026-11-23',
      previous,
      assertHeld: () => Promise.reject(new Error('no request may be made for an empty catalogue')),
      saveProgress: () => Promise.resolve(),
    });

    expect(result).toEqual(previous);
  });
});
