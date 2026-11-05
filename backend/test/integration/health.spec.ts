// Integration: GET /api/health (AR-48) against a real MongoDB (Testcontainers, TESTING §2), through
// the app's own HTTP setup (configureApp), with the clock under test control (AR-24, TS-06).
// supertest binds an ephemeral loopback port in this process (TS-01, TS-07).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { type INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';
import { configureApp } from '../../src/app.setup';
import { AUCTIONS_IMPORT_JOB } from '../../src/auctions/importer/import-job';
import { Clock } from '../../src/common/clock/clock';
import {
  JobExecution,
  type JobExecutionDocument,
} from '../../src/common/schemas/job-execution.schema';
import { HealthModule } from '../../src/health/health.module';
import { aJobExecution } from '../builders/job-execution.builder';
import { FakeClock } from '../fakes/fake-clock';
import { testConfigService } from '../support/test-env';
import { useTestDatabase } from '../support/test-database';

const NOW = new Date('2026-01-15T12:00:00.000Z');

describe('GET /api/health (integration, AR-48)', () => {
  const db = useTestDatabase();
  const clock = new FakeClock(NOW);
  let app: INestApplication;
  let executions: Model<JobExecutionDocument>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(db.uri), HealthModule],
      providers: [{ provide: ConfigService, useValue: testConfigService() }],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    executions = moduleRef.get(getModelToken(JobExecution.name));
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await executions.deleteMany({});
    clock.set(NOW);
  });

  const health = () => request(app.getHttpServer()).get('/api/health');
  const importRun = () => aJobExecution().named(AUCTIONS_IMPORT_JOB);

  it('is ok with the database up and a fresh successful import, unauthenticated', async () => {
    // Finished 2026-01-15T03:00Z, now 12:00Z: 9 h old.
    await executions.create(importRun().finishedAt(new Date('2026-01-15T03:00:00.000Z')).build());
    const warn = vi.spyOn(Logger.prototype, 'warn');

    const response = await health().expect(200);
    expect(warn).not.toHaveBeenCalled();

    // Exactly these fields: no error detail, version or host name (AR-48).
    expect(response.body).toEqual({
      status: 'ok',
      database: { status: 'up' },
      lastImport: {
        status: 'SUCCESS',
        finishedAt: '2026-01-15T03:00:00.000Z',
        ageHours: 9,
        stale: false,
      },
    });
  });

  it('is degraded when the last import, in any run mode, failed', async () => {
    // A success at 03:00Z, then a manual run that failed at 09:00Z (3 h ago): the latest wins.
    await executions.create([
      importRun().finishedAt(new Date('2026-01-15T03:00:00.000Z')).build(),
      importRun()
        .manual()
        .failed('DownloadError')
        .finishedAt(new Date('2026-01-15T09:00:00.000Z'))
        .build(),
    ]);

    const response = await health().expect(200);

    expect(response.body).toEqual({
      status: 'degraded',
      database: { status: 'up' },
      lastImport: {
        status: 'FAILED',
        finishedAt: '2026-01-15T09:00:00.000Z',
        ageHours: 3,
        stale: false,
      },
    });
    // The failure's code stays in jobexecutions; the public body carries none.
    expect(response.text).not.toContain('DownloadError');
  });

  it('is degraded when the last successful import is stale (past 26 h)', async () => {
    // 2026-01-14T09:00Z → 2026-01-15T12:00Z = 27 h > 26 h.
    await executions.create(importRun().finishedAt(new Date('2026-01-14T09:00:00.000Z')).build());

    const response = await health().expect(200);

    expect(response.body).toMatchObject({
      status: 'degraded',
      lastImport: { status: 'SUCCESS', ageHours: 27, stale: true },
    });
  });

  it('is degraded when the import never ran, whatever other jobs did', async () => {
    await executions.create(
      aJobExecution()
        .named('auction-details-scraper')
        .finishedAt(new Date('2026-01-15T11:00:00.000Z'))
        .build(),
    );

    const response = await health().expect(200);

    expect(response.body).toEqual({
      status: 'degraded',
      database: { status: 'up' },
      lastImport: { status: 'NEVER', finishedAt: null, ageHours: null, stale: true },
    });
  });

  it('reads an import recorded before #36 (no status) as a success', async () => {
    await executions.create(
      importRun().legacy().finishedAt(new Date('2026-01-15T06:00:00.000Z')).build(),
    );

    const response = await health().expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      lastImport: { status: 'SUCCESS', ageHours: 6 },
    });
  });

  // Last: it closes the connection the other cases use.
  it('is down with 503 when the database is unreachable', async () => {
    await app.get<Connection>(getConnectionToken()).close();
    const warn = vi.spyOn(Logger.prototype, 'warn');

    const response = await health().expect(503);

    // AR-45: one fixed line for someone to look at, without the driver's error text.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('Database unreachable: health reports down');

    expect(response.body).toEqual({
      status: 'down',
      database: { status: 'down' },
      lastImport: { status: 'NEVER', finishedAt: null, ageHours: null, stale: true },
    });
  });
});
