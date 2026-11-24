// SPEC-004 part 3 integration harness: the REAL orchestrator, run service, list applier, csv cache,
// alert service and calendar over a real MongoDB, with only the edges faked (TS-03, TS-06, TS-07):
// Caixa (FakeCaixaAccess), time (FakeClock), mail (FakeEmailSender), the admins' addresses, the
// enrichment pass, the health record and the neighborhoods cache.
import { vi } from 'vitest';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { TestingModule } from '@nestjs/testing';
import { MongooseModule } from '@nestjs/mongoose';
import {
  CsvUpload,
  CsvUploadSchema,
  type CsvUploadDocument,
} from '../../src/auctions/importer/schemas/csv-upload.schema.js';
import type { StorageService } from '../../src/storage/storage.service.js';
import { FakeListStorage } from '../fakes/fake-list-storage.js';
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
  type EnrichmentPassInput,
} from '../../src/auctions/enrichment/enrichment-pass.js';
import { EnrichmentRepository } from '../../src/auctions/enrichment/enrichment.repository.js';
import { RoundClockService } from '../../src/auctions/enrichment/round-clock.service.js';
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
  /** The whole input of each call, for specs about what the orchestrator hands the pass. */
  readonly inputs: EnrichmentPassInput[] = [];
  result: CollectionResult = { collected: 0, failed: 0, blocked: false, pages: 0 };
  failWith: Error | null = null;
  /** Runs before the pass answers: a spec can simulate a slow or a dying pass. */
  hook: ((input: EnrichmentPassInput) => Promise<void>) | null = null;

  async run(input: EnrichmentPassInput): Promise<CollectionResult> {
    this.calls.push({ importRunId: input.importRunId, brasiliaDate: input.brasiliaDate });
    this.inputs.push(input);
    await this.hook?.(input);
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
  /** The R2 copy of the list (fake) and the record of the upload (real collection). */
  storage: FakeListStorage;
  csvUploads: Model<CsvUploadDocument>;
  /** The neighborhoods-cache invalidation stub: the first thing completing a day calls. */
  auctions: { invalidateNeighborhoodsCache: ReturnType<typeof vi.fn> };
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
  /** A short heartbeat, to watch a lease being renewed in real time. */
  leaseRenewMs: number;
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
        { name: CsvUpload.name, schema: CsvUploadSchema },
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
  const storage = new FakeListStorage();
  const csvUploads = moduleRef.get<Model<CsvUploadDocument>>(getModelToken(CsvUpload.name));
  const csvCache = new CsvCacheService(
    csvUploads,
    storage as unknown as StorageService,
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
    storage,
    csvUploads,
    auctions,
    health,
    admins,
    alerts,
    orchestrator: (business = {}, overrides = {}) => {
      const orchestrator = new ImportOrchestrator(
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
        new RoundClockService(new EnrichmentRepository(kit.auctionModel), kit.changes, clock),
      );
      if (overrides.leaseRenewMs !== undefined) orchestrator.leaseRenewMs = overrides.leaseRenewMs;
      return orchestrator;
    },
  };
  return harness;
}
