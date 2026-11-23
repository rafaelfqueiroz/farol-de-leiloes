// SPEC-010 BR-010-15 / SC-27 (meta-test, TS-14 style): every Mongoose model the API registers with a
// path that names a person (`userId`, `requesterUserId`, `authorUserId`, `buyerUserId`, `adminUserId`,
// `createdBy`) is covered by a provider of the personal-data registry (exported and purged) or declared
// retained with its reason; every retained entry and every provider names a model that exists; no
// model is both. It compiles the API's own modules (FEATURE_MODULES, exactly what AppModule imports) on
// a Testcontainers database, like the isolation gate, and never starts them. A failure names the
// model. The rule's own failure modes are in test/support/personal-data-coverage.spec.ts.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import businessConfig from '../../src/config/business.config.js';
import r2Config from '../../src/config/r2.config.js';
import schedulerConfig from '../../src/config/scheduler.config.js';
import { FEATURE_MODULES } from '../../src/feature-modules.js';
import { PersonalDataRegistry } from '../../src/privacy/registry/personal-data-registry.js';
import { RETAINED_MODELS } from '../../src/privacy/registry/retained-models.js';
import { modelUserPaths, registryProblems } from '../support/personal-data-coverage.js';
import { useTestDatabase } from '../support/test-database.js';
import { testEnv } from '../support/test-env.js';

describe('SPEC-010 SC-27: every model that holds a person is in the registry or declared retained', () => {
  const db = useTestDatabase();
  let moduleRef: TestingModule;
  let registry: PersonalDataRegistry;
  let connection: Connection;

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
    }).compile(); // compiled, never started: providers register when their module is built
    registry = moduleRef.get(PersonalDataRegistry, { strict: false });
    connection = moduleRef.get<Connection>(getConnectionToken());
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('finds the API’s providers (the gate is not looking at an empty registry)', () => {
    expect(registry.providers().map((provider) => provider.name)).toEqual(
      expect.arrayContaining([
        'account',
        'sessions',
        'accountTokens',
        'favorites',
        'savedFilters',
        'reminders',
        'notificationLogs',
        'supportRequests',
        'acceptances',
        'dataExports',
        'actorPseudonyms',
      ]),
    );
  });

  it('SC-27: no model with a user path is left without a provider or a retained declaration', () => {
    const models = modelUserPaths(connection);

    expect(models.filter((model) => model.paths.length > 0).length).toBeGreaterThan(8);
    expect(
      registryProblems(
        models,
        { covered: registry.coveredModels(), providers: registry.providers() },
        RETAINED_MODELS,
      ),
    ).toEqual([]);
  });

  it('the account document itself is covered by the users provider', () => {
    // UserEntity has no user path (the document IS the person), so the path rule above cannot see it.
    const owner = registry.providers().find((provider) => provider.models.includes('UserEntity'));

    expect(owner?.name).toBe('account');
  });

  it('BR-010-22 / BR-010-23: the retained models are the declared ones, each with its rule and reason', () => {
    expect(RETAINED_MODELS.map((entry) => entry.model).sort()).toEqual([
      'AdminAccessLogEntity',
      'ConsentEntity',
      'MaintenanceWindowEntity',
      'SubscriptionEntity',
      'SupportAccessGrantEntity',
      'WhatsappConsentEntity',
    ]);
    for (const entry of RETAINED_MODELS) {
      expect(entry.rule, entry.model).not.toBe('');
      expect(entry.reason.length, entry.model).toBeGreaterThan(20);
    }
  });
});
