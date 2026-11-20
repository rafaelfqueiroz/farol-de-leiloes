// SPEC-010 part 2 (BR-010-08..17, BR-010-28): the app the data-rights specs run: the real AuthModule,
// the modules that hold personal data (favorites, saved filters, reminders), the rights module, the
// registry and the access guards, on the spec's own MongoDB (createIsolationApp). Fakes only at the
// edges (TS-03, TS-07): the clock, the mailer, the four access sources, the R2 port (FakeStorage) and
// the closure hooks SPEC-011 will bind (a recording one).
import type { INestApplication } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { type Connection, type Model, type mongo, Types } from 'mongoose';
import request from 'supertest';
import { AuctionsModule } from '../../src/auctions/auctions.module.js';
import { AuctionEntity } from '../../src/auctions/schemas/auction.schema.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { FavoritesModule } from '../../src/favorites/favorites.module.js';
import { AccountPurgeJob } from '../../src/privacy/rights/account-purge.job.js';
import {
  type AccountClosureHook,
  ACCOUNT_CLOSURE_HOOKS,
} from '../../src/privacy/rights/account-closure.service.js';
import { DataExportJob } from '../../src/privacy/rights/data-export.job.js';
import { PrivacyRightsModule } from '../../src/privacy/rights/privacy-rights.module.js';
import { RemindersModule } from '../../src/reminders/reminders.module.js';
import { RemindersScheduler } from '../../src/reminders/reminders.scheduler.js';
import { SavedFiltersModule } from '../../src/saved-filters/saved-filters.module.js';
import { StorageService } from '../../src/storage/storage.service.js';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import {
  createIsolationApp,
  type IsolationApp,
  type TestAccount,
} from '../isolation/support/isolation-app.js';
import { FakeStorage } from '../fakes/fake-storage.js';
import type { TestDatabase } from './test-database.js';

export const PASSWORD = 'correct horse battery';

let originCounter = 0;
/** A fresh documentation address (RFC 5737): the origin the sign-in throttle counts for (SC-04). */
export function nextOrigin(): string {
  originCounter += 1;
  return `198.51.${100 + Math.floor(originCounter / 250)}.${(originCounter % 250) + 1}`;
}
export const AUCTION_CODE = 'RIGHTS001';
/**
 * The auction opens long after any instant a spec moves the clock to (the harness clock starts on
 * 2099-01-15 and a spec may jump months ahead), so reminders can always be set before it.
 */
const AUCTION_START = '2099-12-31T13:00:00.000Z';
/** A seeded reminder is due one day after the account was seeded (by the harness clock). */
export const REMINDER_DUE_AFTER_MS = 24 * 60 * 60 * 1000;

/** A closure hook that records its calls and can be told to fail (SPEC-011's seam, BR-010-16/17). */
export class RecordingClosureHook implements AccountClosureHook {
  readonly name = 'recorder';
  readonly calls: string[] = [];
  failWith: Error | undefined;

  async onAccountClosed(userId: string): Promise<void> {
    this.calls.push(userId);
    if (this.failWith) throw this.failWith;
  }
}

export interface ScanHit {
  readonly collection: string;
  readonly marker: string;
}

export interface RightsApp extends IsolationApp {
  readonly storage: FakeStorage;
  readonly hook: RecordingClosureHook;
  readonly exportJob: DataExportJob;
  readonly purgeJob: AccountPurgeJob;
  readonly scheduler: RemindersScheduler;
  readonly authService: AuthService;
  readonly users: Model<UserDocument>;
  get<T>(token: abstract new (...args: never[]) => T): T;
  /** The raw collection (the specs look at what is STORED, below every repository). */
  collection(name: string): mongo.Collection;
  /**
   * Looks in EVERY collection of the database for each marker, case-insensitively, in the stored
   * documents as JSON (ObjectIds as hex, dates as ISO text): which `collection` holds which
   * `marker`. The scan behind "a database search finds nothing" (SPEC-010 acceptance criteria).
   */
  scan(markers: readonly string[], options?: { skip?: readonly string[] }): Promise<ScanHit[]>;
  /**
   * A password sign-in (a second device). Every call comes from its own origin unless one is given,
   * so the per-origin sign-in throttle (SC-04) of one test never reaches another's (they share the
   * test process's address).
   */
  signIn(email: string, password?: string, origin?: string): request.Test;
  /** A one-time Google code the callback would have issued for the account's identity. */
  googleCodeFor(email: string, googleId: string): Promise<string>;
}

export async function createRightsApp(
  db: TestDatabase,
  env: Record<string, string> = {},
  prepareApp?: (app: INestApplication) => void,
): Promise<RightsApp> {
  const storage = new FakeStorage();
  const hook = new RecordingClosureHook();
  const app = await createIsolationApp(
    db,
    [AuctionsModule, FavoritesModule, SavedFiltersModule, RemindersModule, PrivacyRightsModule],
    { REMINDERS_ENABLED: 'true', R2_PRIVATE_BUCKET: 'test-private-bucket', ...env },
    prepareApp,
    (builder) =>
      builder
        .overrideProvider(StorageService)
        .useValue(storage)
        .overrideProvider(ACCOUNT_CLOSURE_HOOKS)
        .useValue([hook]),
  );
  const moduleRef = app.harness.moduleRef;
  const auctions = moduleRef.get<Model<unknown>>(getModelToken(AuctionEntity.name));
  const phase = { modality: 'ONLINE_SALES', minimumPrice: null, phaseDates: [AUCTION_START] };
  await auctions.collection.insertOne({
    code: AUCTION_CODE,
    available: true,
    phases: [phase],
    currentPhase: phase,
    updatedAt: new Date('2999-01-01T00:00:00.000Z'),
  });
  const authService = moduleRef.get(AuthService);
  const server = () => app.harness.app.getHttpServer() as Parameters<typeof request>[0];
  return {
    ...app,
    as: app.as,
    close: () => app.close(),
    storage,
    hook,
    exportJob: moduleRef.get(DataExportJob),
    purgeJob: moduleRef.get(AccountPurgeJob),
    scheduler: moduleRef.get(RemindersScheduler),
    authService,
    users: moduleRef.get<Model<UserDocument>>(getModelToken(UserEntity.name)),
    get: (token) => moduleRef.get(token, { strict: false }),
    collection: (name) => moduleRef.get<Connection>(getConnectionToken()).collection(name),
    scan: async (markers, options = {}) => {
      const db = moduleRef.get<Connection>(getConnectionToken()).db;
      if (!db) throw new Error('no database');
      const hits: ScanHit[] = [];
      for (const { name } of await db.listCollections().toArray()) {
        if (options.skip?.includes(name)) continue;
        for (const document of await db.collection(name).find({}).toArray()) {
          const text = JSON.stringify(document).toLowerCase();
          for (const marker of markers) {
            if (text.includes(marker.toLowerCase())) hits.push({ collection: name, marker });
          }
        }
      }
      return hits;
    },
    signIn: (email, password = PASSWORD, origin = nextOrigin()) =>
      request(server())
        .post('/api/auth/login')
        .set('X-Forwarded-For', origin)
        .send({ email, password }),
    googleCodeFor: (email, googleId) =>
      authService.beginGoogleSignIn({
        googleId,
        email,
        name: 'Google Name',
        emailVerified: true,
      }),
  };
}

/** What an account of the data specs holds: every kind of personal data this part handles. */
export interface SeededAccount extends TestAccount {
  readonly name: string;
  readonly phone: string;
}

/**
 * A signed-up, confirmed account that holds data in every provider: a phone, a favorite, a saved
 * filter with a price bound, a reminder and a WhatsApp answer (the acceptances come with the
 * sign-up). The name, the email and the phone are distinguishable markers (the scans look for them).
 */
export async function seedAccount(
  app: RightsApp,
  label: string,
  name: string,
  phone: string,
): Promise<SeededAccount> {
  const account = await app.signUp(label, name);
  const as = app.as(account);
  await as.patch('/api/auth/profile').send({ phone }).expect(200);
  await as.post('/api/favorites').send({ code: AUCTION_CODE }).expect(201);
  await as
    .post('/api/saved-filters')
    .send({ name: `${label}-filtro`, filters: { state: 'RN', minPrice: '120000.50' } })
    .expect(201);
  await as
    .post('/api/reminders')
    .send({
      auctionId: AUCTION_CODE,
      channel: 'EMAIL',
      scheduledAt: new Date(
        app.harness.clock.now().getTime() + REMINDER_DUE_AFTER_MS,
      ).toISOString(),
      description: `${label}-lembrete`,
    })
    .expect(201);
  await as
    .post('/api/privacy/whatsapp-consent')
    .send({ action: 'granted', method: 'privacy_page' })
    .expect(200);
  return { ...account, name, phone };
}

/** The ObjectId of an account or record id as the API answers it. */
export const oid = (id: string): Types.ObjectId => new Types.ObjectId(id);
