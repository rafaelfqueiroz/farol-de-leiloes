// SPEC-004 part 3 integration harness: the REAL orchestrator, run service, list applier, csv cache,
// alert service and calendar over a real MongoDB, with only the edges faked (TS-03, TS-06, TS-07):
// Caixa (FakeCaixaAccess), time (FakeClock), mail (FakeEmailSender), the admins' addresses, the
// enrichment pass, the health record and the neighborhoods cache.
import { vi } from 'vitest';
import type { TestingModule } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { EmailService } from '../../src/email/email.service.js';
import type { UsersService } from '../../src/users/users.service.js';
import type { AuctionsService } from '../../src/auctions/auctions.service.js';
import type { JobExecutionService } from '../../src/common/services/job-execution.service.js';
import { BusinessCalendar } from '../../src/common/services/business-calendar.service.js';
import { CsvCacheService } from '../../src/auctions/importer/csv-cache.service.js';
import { ImportOrchestrator } from '../../src/auctions/importer/import-orchestrator.service.js';
import {
  DailyUpdateBus,
  type DailyUpdateCompleted,
} from '../../src/auctions/import-runs/daily-update-bus.js';
import { ImportAlertService } from '../../src/auctions/import-runs/import-alert.service.js';
import {
  type CollectionResult,
  EnrichmentPass,
} from '../../src/auctions/enrichment/enrichment-pass.js';
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
import type { Clock } from '../../src/common/clock/clock.js';
import { FakeCaixaAccess } from '../fakes/fake-caixa-access.js';
import { FakeClock } from '../fakes/fake-clock.js';
import { FakeEmailSender } from '../fakes/fake-email-sender.js';
import { type ImportKit, importKit } from './list-applier.js';
import { testBusinessConfig } from './test-env.js';

/** A hand-written EnrichmentPass (TS-03): the result it answers, and the calls it received. */
export class FakeEnrichmentPass extends EnrichmentPass {
  readonly calls: { importRunId: string; brasiliaDate: string }[] = [];
  result: CollectionResult = { collected: 0, failed: 0, blocked: false };
  failWith: Error | null = null;
  /** Runs before the pass answers: a spec can simulate a slow or a dying pass. */
  hook: (() => Promise<void>) | null = null;

  async run(input: { importRunId: string; brasiliaDate: string }): Promise<CollectionResult> {
    this.calls.push(input);
    await this.hook?.();
    if (this.failWith !== null) throw this.failWith;
    return this.result;
  }
}

export interface ImportHarness {
  moduleRef: TestingModule;
  kit: ImportKit;
  clock: FakeClock;
  caixa: FakeCaixaAccess;
  email: FakeEmailSender;
  enrichment: FakeEnrichmentPass;
  bus: DailyUpdateBus;
  events: DailyUpdateCompleted[];
  health: { recordExecution: ReturnType<typeof vi.fn>; recordFailure: ReturnType<typeof vi.fn> };
  /** The admins' addresses `findAdminEmails` answers. */
  admins: string[];
  alerts: ImportAlertService;
  /** Builds an orchestrator over the same stores; `business` overrides env settings (a new one reads NATIONAL_HOLIDAYS afresh, as a restart does). */
  orchestrator(
    business?: Record<string, string>,
    overrides?: Partial<Collaborators>,
  ): ImportOrchestrator;
}

interface Collaborators {
  applier: ImportKit['applier'];
  enrichment: EnrichmentPass;
}

export async function createImportHarness(uri: string, start: Date): Promise<ImportHarness> {
  applyMongooseDefaults(); // as in production (SC-10)
  const moduleRef = await Test.createTestingModule({
    imports: [
      MongooseModule.forRoot(uri),
      MongooseModule.forFeature([
        { name: AuctionEntity.name, schema: AuctionSchema },
        { name: ImportRunEntity.name, schema: ImportRunSchema },
        { name: PropertyChangeEntity.name, schema: PropertyChangeSchema },
      ]),
    ],
  }).compile();
  const clock = new FakeClock(start);
  const kit = importKit(moduleRef, clock);
  await kit.runModel.syncIndexes();
  await kit.changeModel.syncIndexes();

  const caixa = new FakeCaixaAccess();
  const email = new FakeEmailSender();
  const enrichment = new FakeEnrichmentPass();
  const bus = new DailyUpdateBus();
  const events: DailyUpdateCompleted[] = [];
  bus.subscribe((event) => {
    events.push(event);
  });
  const health = {
    recordExecution: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const admins = ['admin.um@example.test', 'admin.dois@example.test'];
  const users = { findAdminEmails: () => Promise.resolve([...admins]) };
  const alerts = new ImportAlertService(
    kit.runs,
    users as unknown as UsersService,
    email as unknown as EmailService,
  );
  const csvCache = new CsvCacheService(
    {} as never,
    { isConfigured: () => false } as never,
    clock as Clock,
    caixa,
  );
  const auctions = { invalidateNeighborhoodsCache: vi.fn().mockResolvedValue(undefined) };

  const harness: ImportHarness = {
    moduleRef,
    kit,
    clock,
    caixa,
    email,
    enrichment,
    bus,
    events,
    health,
    admins,
    alerts,
    orchestrator: (business = {}, overrides = {}) =>
      new ImportOrchestrator(
        kit.runs,
        csvCache,
        overrides.applier ?? kit.applier,
        new BusinessCalendar(testBusinessConfig(business), clock),
        clock,
        testBusinessConfig(business),
        auctions as unknown as AuctionsService,
        health as unknown as JobExecutionService,
        overrides.enrichment ?? enrichment,
        bus,
        alerts,
      ),
  };
  return harness;
}
