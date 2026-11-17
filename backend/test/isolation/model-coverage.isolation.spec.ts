// SPEC-002 TS-14 / AR-16: THE ISOLATION GATE. Compiles the API's own modules (FEATURE_MODULES,
// exactly what AppModule imports after its infrastructure) on a Testcontainers database, lists
// every Mongoose model they register, and fails on:
//   - an owned model (an `ownerId` path, AR-11) that no isolation spec names (TS-13);
//   - an account-data model (marked 'account', BR-002-02) that no isolation spec names;
//   - a model with neither `ownerId` nor an isolation mark (markIsolation, src/access/).
// A spec "names" a model with isolationSpecFor('<ModelName>', ...) (support/isolation-spec.ts),
// found by reading every test/isolation/**/*.isolation.spec.ts: there is no hand-kept list.
//
// AppModule itself is not compiled: its ConfigModule.forRoot reads the process environment and a
// .env file as it is imported (DV-19). The infrastructure it adds registers no model; the gate
// replaces it with the validated test environment and this file's own database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Connection, Schema } from 'mongoose';
import { markIsolation } from '../../src/access/isolation-mark.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import businessConfig from '../../src/config/business.config.js';
import r2Config from '../../src/config/r2.config.js';
import schedulerConfig from '../../src/config/scheduler.config.js';
import { FEATURE_MODULES } from '../../src/feature-modules.js';
import { testEnv } from '../support/test-env.js';
import { useTestDatabase } from '../support/test-database.js';
import {
  coverageProblems,
  isolationOf,
  isolationSpecFiles,
  type ModelIsolation,
  modelIsolations,
  modelsNamedIn,
  modelsWithIsolationSpec,
} from './support/isolation-coverage.js';

describe('TS-14: every model the API registers is classified, and every owned one has its spec', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let models: ModelIsolation[];

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () =>
            testEnv({
              MONGODB_URI: db.uri,
              IMPORT_ENABLED: 'false',
              SCRAPER_ENABLED: 'false',
              REMINDERS_ENABLED: 'false',
            }),
          load: [schedulerConfig, r2Config, businessConfig],
        }),
        MongooseModule.forRoot(db.uri),
        ...FEATURE_MODULES,
      ],
    }).compile(); // compiled, never started: no cron, no start-up job runs
    models = modelIsolations(moduleRef.get<Connection>(getConnectionToken()));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('finds the API’s models (the gate is not looking at an empty app)', () => {
    expect(models.map((model) => model.name)).toEqual(
      expect.arrayContaining(['UserEntity', 'AuctionEntity', 'FavoriteEntity', 'ReminderEntity']),
    );
  });

  it('AR-16 / TS-13 / TS-14: no model breaks the gate', () => {
    expect(coverageProblems(models, modelsWithIsolationSpec())).toEqual([]);
  });

  it('BR-002-02: the account-data collections are the ones marked so', () => {
    const account = models.filter((model) => model.mark?.kind === 'account');

    expect(account.map((model) => model.name)).toEqual([
      'FavoriteEntity',
      'NotificationLog',
      'ReminderEntity',
      'SavedFilterEntity',
    ]);
  });
});

// The gate's own failure modes (TS-14 is only worth something if it can fail).
describe('the isolation gate itself', () => {
  // Built from parts so this file's own text names no model by accident.
  const callNaming = (name: string) => `${'isolationSpec'}For('${name}', () => {});`;

  function unmarked(): ModelIsolation {
    return isolationOf('UnmarkedEntity', new Schema({ name: String }));
  }

  function owned(): ModelIsolation {
    return isolationOf(
      'OwnedEntity',
      new Schema({ ownerType: String, ownerId: Schema.Types.ObjectId }),
    );
  }

  function marked(kind: 'public' | 'internal' | 'account'): ModelIsolation {
    const schema = new Schema({ userId: Schema.Types.ObjectId });
    markIsolation(schema, { kind, reason: 'a reason' });
    return isolationOf(`${kind}Entity`, schema);
  }

  it('fails a model with neither ownerId nor a mark', () => {
    expect(coverageProblems([unmarked()], new Set())).toEqual([
      'UnmarkedEntity: neither ownerId nor an isolation mark (AR-16: markIsolation)',
    ]);
  });

  it('fails an owned model that no spec names, and passes it once one does', () => {
    expect(coverageProblems([owned()], new Set())).toEqual([
      'OwnedEntity: owned (ownerId) with no isolation spec naming it (TS-13, TS-14)',
    ]);
    expect(coverageProblems([owned()], new Set(['OwnedEntity']))).toEqual([]);
  });

  it('fails an account-data model that no spec names', () => {
    expect(coverageProblems([marked('account')], new Set())).toEqual([
      'accountEntity: account data (BR-002-02) with no isolation spec naming it (TS-13)',
    ]);
    expect(coverageProblems([marked('account')], new Set(['accountEntity']))).toEqual([]);
  });

  it('needs no spec for a public or internal model', () => {
    expect(coverageProblems([marked('public'), marked('internal')], new Set())).toEqual([]);
  });

  it('reads the names a spec gives isolationSpecFor, and nothing else', () => {
    const source = [
      callNaming('FavoriteEntity'),
      callNaming('ProbeEntity').replace(/'/g, '"'),
      "describe('FavoriteEntity is mentioned, not named', () => {});",
    ].join('\n');

    expect(modelsNamedIn(source)).toEqual(['FavoriteEntity', 'ProbeEntity']);
  });

  it('scans the isolation spec files of this folder, this one included', () => {
    const files = isolationSpecFiles();

    expect(files.some((file) => file.endsWith('model-coverage.isolation.spec.ts'))).toBe(true);
    expect(files.every((file) => file.endsWith('.isolation.spec.ts'))).toBe(true);
    // This file builds its sample calls from parts, so it names no model itself.
    expect(modelsWithIsolationSpec().has('UnmarkedEntity')).toBe(false);
  });
});
