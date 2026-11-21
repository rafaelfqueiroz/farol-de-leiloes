// SPEC-010 BR-010-18..21, BR-010-24 (TS-08): the document retention job on a real MongoDB: the lock,
// the unique log row, idempotency and a crash between the deletion and the row. The source is the fake
// of SPEC-017's seam; the clock is the Brasília day. The rule's examples are in
// privacy/domain/retention.spec.ts and privacy/retention/retention.service.spec.ts.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { Clock } from '../../src/common/clock/clock.js';
import { RunMode } from '../../src/common/job-execution.js';
import { JobExecutionService } from '../../src/common/services/job-execution.service.js';
import { createRetentionLegalIndexes } from '../../src/migrations/0010-retention-legal-indexes.migration.js';
import {
  CLOSED_JOURNEY_FILES_SOURCE,
  NoClosedJourneyFilesSource,
} from '../../src/privacy/retention/closed-journey-files.source.js';
import {
  DOCUMENT_RETENTION_JOB,
  DocumentRetentionJob,
} from '../../src/privacy/retention/document-retention.job.js';
import { LegalValidationsRepository } from '../../src/privacy/legal-validation/legal-validations.repository.js';
import { UNVALIDATED_RUN_CAP } from '../../src/privacy/domain/retention.js';
import { RetentionDeletionsRepository } from '../../src/privacy/retention/retention-deletions.repository.js';
import { PrivacyRetentionModule } from '../../src/privacy/retention/privacy-retention.module.js';
import { RetentionDeletionEntity } from '../../src/privacy/schemas/retention-deletion.schema.js';
import { FakeClock } from '../fakes/fake-clock.js';
import { FakeClosedJourneyFilesSource } from '../fakes/fake-closed-journey-files-source.js';
import { captureAllLogOutput } from '../support/logger-spy.js';
import { useTestDatabase } from '../support/test-database.js';
import { testEnv } from '../support/test-env.js';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';

/** Noon in Brasília (15:00 UTC) of the day. */
const noonOn = (date: string) => new Date(`${date}T15:00:00.000Z`);

describe('document retention (integration)', () => {
  const db = useTestDatabase();
  const clock = new FakeClock(noonOn('2032-03-16'));
  const source = new FakeClosedJourneyFilesSource();
  let moduleRef: TestingModule;
  let job: DocumentRetentionJob;
  let connection: Connection;
  let log: Model<unknown>;
  let validations: LegalValidationsRepository;

  const rows = () => log.collection.find({}).sort({ _id: 1 }).toArray();

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: () => testEnv() }),
        MongooseModule.forRoot(db.uri),
        PrivacyRetentionModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(CLOSED_JOURNEY_FILES_SOURCE)
      .useValue(source)
      .compile();
    await moduleRef.init();
    job = moduleRef.get(DocumentRetentionJob);
    connection = moduleRef.get<Connection>(getConnectionToken());
    log = moduleRef.get(getModelToken(RetentionDeletionEntity.name));
    validations = moduleRef.get(LegalValidationsRepository);
    await createRetentionLegalIndexes(connection.db as never); // AR-29: the migration builds them
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await log.collection.deleteMany({});
    await connection.collection('jobexecutions').deleteMany({});
    await connection.collection('jobLocks').deleteMany({});
    // The period is validated for the setting (5), so the safety brake is off unless a test sets it.
    await connection.collection('legalValidations').deleteMany({});
    await validations.insert({
      scope: 'retention-periods',
      validatedAt: new Date('2026-01-01T00:00:00.000Z'),
      validatorName: 'Dra. Fulana',
      documentVersions: [],
      retentionYears: 5,
    });
    source.journeys.length = 0;
    source.purgeCalls.length = 0;
    source.acknowledged.length = 0;
    source.failingAcknowledge.clear();
    source.failing.clear();
    source.hold = undefined;
    source.ignoreCutoff = false;
    clock.set(noonOn('2032-03-16'));
  });

  it('deletes what is due, logs one row with ids, a count and a date, and records the run', async () => {
    const due = source.add('2027-03-15', { files: 4 });
    const kept = source.add('2027-03-16', { files: 2 });

    expect(await job.run()).toMatchObject({ deleted: 1, files: 4, failed: 0 });

    expect(source.journeys.find((j) => j.journeyId === due.journeyId)?.purged).toBe(true);
    expect(source.journeys.find((j) => j.journeyId === kept.journeyId)?.purged).toBe(false);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      journeyOwnerType: 'office',
      fileCount: 4,
      deletedAt: noonOn('2032-03-16'),
    });
    expect(String(stored[0]?.['journeyId'])).toBe(due.journeyId);
    // Ids, a count and a date: nothing else (BR-010-21).
    expect(Object.keys(stored[0] ?? {}).sort()).toEqual(
      [
        '__v',
        '_id',
        'createdAt',
        'deletedAt',
        'fileCount',
        'journeyId',
        'journeyOwnerId',
        'journeyOwnerType',
        'updatedAt',
      ].sort(),
    );
    const executions = await moduleRef
      .get(JobExecutionService)
      .getLastExecution(DOCUMENT_RETENTION_JOB, RunMode.AUTO);
    expect(executions).not.toBeNull();
  });

  it('is idempotent: a second run lists nothing, and the journey is acknowledged once', async () => {
    const journey = source.add('2027-03-15', { files: 3 });

    await job.run();
    expect(await job.run()).toMatchObject({ deleted: 0, files: 0, failed: 0 });

    expect(await rows()).toHaveLength(1);
    expect(source.purgeCalls).toEqual([journey.journeyId]);
    expect(source.acknowledged).toEqual([journey.journeyId]);
  });

  it('repairs a crash between the deletion and the row: the journey stays listed and the next run writes the row', async () => {
    const journey = source.add('2027-03-15', { files: 6 });
    const insert = vi
      .spyOn(moduleRef.get(RetentionDeletionsRepository), 'insert')
      .mockRejectedValue(new Error('database down'));
    try {
      expect(await job.run()).toMatchObject({ deleted: 0, failed: 1, unrecorded: 1 });
    } finally {
      insert.mockRestore();
    }
    expect(await rows()).toHaveLength(0);
    expect(journey.files).toBe(0); // the files are gone
    expect(journey.purged).toBe(false); // but the source keeps listing it: it was not acknowledged

    expect(await job.run()).toMatchObject({ deleted: 1, failed: 0 });

    // The repeat found nothing to delete, so the row undercounts (0): documented, accepted.
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ fileCount: 0 });
    expect(source.acknowledged).toEqual([journey.journeyId]);
  });

  it('repairs a crash between the row and the acknowledgement: the duplicate row is success', async () => {
    const journey = source.add('2027-03-15', { files: 4 });
    source.failingAcknowledge.add(journey.journeyId);

    expect(await job.run()).toMatchObject({ deleted: 1, files: 4, failed: 1 });
    expect(await rows()).toHaveLength(1);

    source.failingAcknowledge.clear();
    expect(await job.run()).toMatchObject({ deleted: 1, files: 0, failed: 0 });

    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ fileCount: 4 }); // the first row stays as written
    expect(source.acknowledged).toEqual([journey.journeyId]);
    expect(await job.run()).toMatchObject({ deleted: 0 });
  });

  it('lowering the period below the validated one caps the run at a few journeys, with the real validations', async () => {
    await validations.insert({
      scope: 'retention-periods',
      validatedAt: new Date('2026-01-01T00:00:00.000Z'),
      validatorName: 'Dra. Fulana',
      documentVersions: [],
      retentionYears: 6, // the setting is 5
    });
    for (let i = 0; i < UNVALIDATED_RUN_CAP + 5; i += 1) source.add('2027-03-15', { files: 1 });

    expect(await job.run()).toMatchObject({
      deleted: UNVALIDATED_RUN_CAP,
      capped: true,
      review: 'lowered',
    });
    expect(await rows()).toHaveLength(UNVALIDATED_RUN_CAP);
  });

  it('two runs at once delete once: the second finds the lock held and does nothing', async () => {
    source.add('2027-03-15', { files: 2 });
    let release: () => void = () => undefined;
    source.hold = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = job.run();
    // Let the first run take the lock and reach purgeFiles.
    for (let i = 0; i < 50 && source.purgeCalls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(source.purgeCalls).toHaveLength(1);
    const second = await job.run();
    release();
    const firstOutcome = await first;

    expect(second).toBeNull();
    expect(firstOutcome).toMatchObject({ deleted: 1 });
    expect(source.purgeCalls).toHaveLength(1);
    expect(await rows()).toHaveLength(1);
  });

  it('a failing deletion leaves no row, records the partial failure, and the next run retries it', async () => {
    const bad = source.add('2027-03-15', { files: 2 });
    const good = source.add('2027-03-14', { files: 1 });
    source.failing.add(bad.journeyId);

    expect(await job.run()).toMatchObject({ deleted: 1, failed: 1 });
    expect(await rows()).toHaveLength(1);
    expect(String((await rows())[0]?.['journeyId'])).toBe(good.journeyId);
    const failed = await connection
      .collection('jobexecutions')
      .findOne({ jobName: DOCUMENT_RETENTION_JOB, status: 'FAILED' });
    expect(failed).toMatchObject({ errorCode: 'PARTIAL_FAILURE' });

    source.failing.clear();
    expect(await job.run()).toMatchObject({ deleted: 1, files: 2, failed: 0 });
    expect(await rows()).toHaveLength(2);
  });

  it('the log is insert-only: no update and no delete reaches a row', async () => {
    source.add('2027-03-15');
    await job.run();

    await expect(log.updateOne({}, { $set: { fileCount: 0 } })).rejects.toThrow('insert-only');
    await expect(log.deleteMany({})).rejects.toThrow('insert-only');
    expect(await rows()).toHaveLength(1);
  });

  it('logs nothing about the journey, its owner or the files (SC-15, BR-010-21)', async () => {
    const capture = captureAllLogOutput();
    try {
      const bad = source.add('2027-03-15');
      const good = source.add('2027-03-14');
      source.failing.add(bad.journeyId);
      await job.run();

      const logged = capture.text();
      expect(logged).toContain('Document retention');
      for (const secret of [
        bad.journeyId,
        bad.ownerId,
        good.journeyId,
        good.ownerId,
        'secret.pdf',
      ]) {
        expect(logged).not.toContain(secret);
      }
    } finally {
      capture.restore();
    }
  });

  it('with the default source (before SPEC-017) a run finds nothing and still records itself', async () => {
    const none = new NoClosedJourneyFilesSource();
    expect(await none.listClosedJourneys()).toEqual([]);
    expect(await none.purgeFiles()).toEqual({ fileCount: 0 });
    expect(await job.run()).toMatchObject({ deleted: 0, files: 0, failed: 0 });
  });
});
