// SPEC-004 part 3: the real dependency graph of AuctionsModule resolves (the orchestrator, the
// alert service, the run service, the signal bus, the enrichment seam and the two controllers), and
// the enrichment seam defaults to the no-op until part 4 provides the real pass.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { AuctionsModule } from '../../src/auctions/auctions.module.js';
import { AuctionsImporter } from '../../src/auctions/importer/scheduler.js';
import { ImportOrchestrator } from '../../src/auctions/importer/import-orchestrator.service.js';
import { ImportAlertService } from '../../src/auctions/import-runs/import-alert.service.js';
import { DailyUpdateBus } from '../../src/auctions/import-runs/daily-update-bus.js';
import {
  EnrichmentPass,
  NoopEnrichmentPass,
} from '../../src/auctions/enrichment/enrichment-pass.js';
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

  it('collects nothing until part 4 provides the real pass', async () => {
    const pass = moduleRef.get(EnrichmentPass);

    expect(pass).toBeInstanceOf(NoopEnrichmentPass);
    expect(await pass.run({ importRunId: 'run-1', brasiliaDate: '2026-11-23' })).toEqual({
      collected: 0,
      failed: 0,
      blocked: false,
    });
  });
});
