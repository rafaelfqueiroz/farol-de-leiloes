// SPEC-002 TS-14 / AR-16: THE ISOLATION GATE. Compiles the API's own modules (FEATURE_MODULES,
// exactly what AppModule imports after its infrastructure) on a Testcontainers database, lists
// every Mongoose model they register, and fails on:
//   - an owned model (an `ownerId` path, AR-11) that no isolation spec names (TS-13);
//   - an account-data model (marked 'account', BR-002-02) that no isolation spec names;
//   - a model with neither `ownerId` nor an isolation mark (markIsolation, src/access/).
// A spec "names" a model with isolationSpecFor('<ModelName>', ...) (support/isolation-spec.ts),
// found by parsing every test/isolation/**/*.isolation.spec.ts with the TypeScript parser: only
// real calls count (never a comment or a string), and a file that skips, focuses or postpones tests,
// or a call whose body runs no test, fails the gate. There is no hand-kept list.
// Syntax is not proof, though: a loop over no scenarios, a condition or an uncalled helper looks like
// a test and runs none. So after ALL files finish, IsolationRunReporter (support/isolation-reporter.ts)
// also requires, for every model this file's AR-16 test declares, an isolation test that RAN and
// PASSED in this run (support/executed-isolation.ts, tested in executed-isolation.isolation-gate.spec.ts).
//
// AppModule itself is not compiled: its ConfigModule.forRoot reads the process environment and a
// .env file as it is imported (DV-19). The infrastructure it adds registers no model; the gate
// replaces it with the validated test environment and this file's own database.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import { type Connection, Schema } from 'mongoose';
import { REQUIRED_MODELS } from './support/executed-isolation.js';
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
  isolationSpecProblems,
  type ModelIsolation,
  modelIsolations,
  modelsNamedIn,
  modelsWithIsolationSpec,
  requiredModelNames,
  scanIsolationSpec,
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

  it('AR-16 / TS-13 / TS-14: no model breaks the gate', ({ task }) => {
    // The run-time half (support/executed-isolation.ts): this test declares which models need an
    // isolation test; IsolationRunReporter fails the run for each one without a PASSED one.
    task.meta[REQUIRED_MODELS] = requiredModelNames(models);
    expect(coverageProblems(models, modelsWithIsolationSpec())).toEqual([]);
  });

  it('TS-14: no isolation spec skips, focuses or postpones a test, or names a model and runs none', () => {
    expect(isolationSpecProblems()).toEqual([]);
  });

  it('BR-002-02: the account-data collections are the ones marked so', () => {
    const account = models.filter((model) => model.mark?.kind === 'account');

    expect(account.map((model) => model.name)).toEqual([
      'FavoriteEntity',
      'NotificationLog',
      'ReminderEntity',
      'SavedFilterEntity',
      'SupportRequestEntity',
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

  // A test call built from parts too, for the same reason.
  const testCall = (modifier = '') => `${'it'}${modifier}('proves it', () => {});`;
  const naming = (name: string, body: string) =>
    `${'isolationSpec'}For('${name}', () => {\n${body}\n});`;

  it('reads the names a spec gives isolationSpecFor, and nothing else', () => {
    const source = [
      naming('FavoriteEntity', testCall()),
      naming('ProbeEntity', testCall()).replace(/'ProbeEntity'/, '"ProbeEntity"'),
      "describe('FavoriteEntity is mentioned, not named', () => {});",
    ].join('\n');

    expect(modelsNamedIn(source)).toEqual(['FavoriteEntity', 'ProbeEntity']);
    expect(scanIsolationSpec(source).problems).toEqual([]);
  });

  it('TS-14: a model named only in a comment or a string is not covered', () => {
    const source = [
      `// ${callNaming('CommentedEntity')}`,
      `/* ${callNaming('BlockCommentedEntity')} */`,
      `const text = "${callNaming('QuotedEntity')}";`,
      `describe('real tests', () => { ${testCall()} });`,
    ].join('\n');

    expect(modelsNamedIn(source)).toEqual([]);
    expect(coverageProblems([owned()], new Set(modelsNamedIn(source)))).toHaveLength(1);
  });

  it.each([
    ['a skipped test', testCall('.skip')],
    ['a focused test', testCall('.only')],
    ['a postponed test', `${'it'}.todo('later');\n${testCall()}`],
    ['a conditionally skipped test', `${'it'}.skipIf(true)('x', () => {});\n${testCall()}`],
    ['a test skipped from its context', `${'it'}('x', (ctx) => { ctx.${'skip'}(); });`],
    ['an xit', `${'x'}it('x', () => {});\n${testCall()}`],
    ['an xdescribe', `${'x'}describe('x', () => { ${testCall()} });\n${testCall()}`],
    ['a skipped describe', `${'describe'}.skip('x', () => { ${testCall()} });\n${testCall()}`],
  ])('TS-14: a spec with %s fails, and covers nothing', (_case, body) => {
    const scan = scanIsolationSpec(naming('OwnedEntity', body), 'x.isolation.spec.ts');

    expect(scan.models).toEqual(['OwnedEntity']);
    expect(scan.problems).toHaveLength(1);
    expect(scan.problems[0]).toMatch(/^x\.isolation\.spec\.ts:\d+: .*(skips|focuses)/);
  });

  it('TS-14: a skipped isolationSpecFor block fails', () => {
    const source = `${'isolationSpec'}For.skip('OwnedEntity', () => { ${testCall()} });`;

    expect(scanIsolationSpec(source).problems).toEqual([]); // names nothing: not a covering call
    expect(modelsNamedIn(source)).toEqual([]);
    const both = [naming('OwnedEntity', testCall()), source].join('\n');
    expect(scanIsolationSpec(both).problems).toEqual([
      'spec.ts:4: isolationSpecFor.skip skips, focuses or postpones tests',
    ]);
  });

  it('TS-14: a naming call that runs no test, or names no literal, fails', () => {
    expect(scanIsolationSpec(naming('OwnedEntity', '// nothing yet')).problems).toEqual([
      "spec.ts:1: isolationSpecFor('OwnedEntity') runs no it(...) or test(...)",
    ]);
    expect(
      scanIsolationSpec(`${'isolationSpec'}For(modelName, () => { ${testCall()} });`).problems,
    ).toEqual(['spec.ts:1: isolationSpecFor names its model with a string literal']);
  });

  it('TS-14: a file with a problem covers none of its models (fail closed)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'isolation-gate-'));
    try {
      writeFileSync(join(dir, 'good.isolation.spec.ts'), naming('GoodEntity', testCall()));
      writeFileSync(join(dir, 'bad.isolation.spec.ts'), naming('BadEntity', testCall('.only')));

      expect([...modelsWithIsolationSpec(dir)]).toEqual(['GoodEntity']);
      expect(isolationSpecProblems(dir)).toEqual([
        'bad.isolation.spec.ts:2: it.only skips, focuses or postpones tests',
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('scans the isolation spec files of this folder, this one included', () => {
    const files = isolationSpecFiles();

    expect(files.some((file) => file.endsWith('model-coverage.isolation.spec.ts'))).toBe(true);
    expect(files.every((file) => file.endsWith('.isolation.spec.ts'))).toBe(true);
    // This file builds its sample calls from parts, so it names no model itself.
    expect(modelsWithIsolationSpec().has('UnmarkedEntity')).toBe(false);
  });
});
