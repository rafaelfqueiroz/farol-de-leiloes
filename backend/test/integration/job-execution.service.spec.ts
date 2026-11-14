// Integration: JobExecutionService against a real MongoDB (Testcontainers, TESTING §2), with the
// clock under test control (AR-24, TS-06). Proves the integration harness end to end: per-file
// database (TS-05), Nest testing module, FakeClock override and builders (TS-29).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Model } from 'mongoose';
import { Clock } from '../../src/common/clock/clock.js';
import { CommonModule } from '../../src/common/common.module.js';
import {
  JobExecution,
  type JobExecutionDocument,
} from '../../src/common/schemas/job-execution.schema.js';
import { JobStatus, RunMode } from '../../src/common/job-execution.js';
import { JobExecutionService } from '../../src/common/services/job-execution.service.js';
import { aJobExecution } from '../builders/job-execution.builder.js';
import { FakeClock, HOUR, MINUTE } from '../fakes/fake-clock.js';
import { useTestDatabase } from '../support/test-database.js';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const JOB = 'import-csv';

describe('JobExecutionService (integration)', () => {
  const db = useTestDatabase();
  const clock = new FakeClock(NOW);
  let moduleRef: TestingModule;
  let service: JobExecutionService;
  let executions: Model<JobExecutionDocument>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(db.uri), CommonModule],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .compile();
    service = moduleRef.get(JobExecutionService);
    executions = moduleRef.get(getModelToken(JobExecution.name));
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  beforeEach(async () => {
    await executions.deleteMany({});
    clock.set(NOW);
  });

  describe('hasRunRecently', () => {
    it('is false when the job never ran', async () => {
      await expect(service.hasRunRecently(JOB, RunMode.AUTO, 24)).resolves.toBe(false);
    });

    it('is true just inside the window and false exactly at its edge', async () => {
      // Finished 10:00Z; now 12:00Z -> 2 h since the last run.
      await executions.create(
        aJobExecution().named(JOB).finishedAt(new Date('2026-01-15T10:00:00.000Z')).build(),
      );

      // 2 h < 3 h -> recent.
      await expect(service.hasRunRecently(JOB, RunMode.AUTO, 3)).resolves.toBe(true);
      // 2 h < 2 h is false: the window is exclusive at its edge.
      await expect(service.hasRunRecently(JOB, RunMode.AUTO, 2)).resolves.toBe(false);

      // Move now back 1 min to 11:59Z -> 1 h 59 min < 2 h -> recent.
      clock.set(new Date('2026-01-15T11:59:00.000Z'));
      await expect(service.hasRunRecently(JOB, RunMode.AUTO, 2)).resolves.toBe(true);
    });

    it('measures from the latest execution, not an older one', async () => {
      // Older: 2026-01-14T06:00Z, 30 h before now. Latest: 11:00Z, 1 h before now.
      await executions.create([
        aJobExecution().named(JOB).finishedAt(new Date('2026-01-14T06:00:00.000Z')).build(),
        aJobExecution().named(JOB).finishedAt(new Date('2026-01-15T11:00:00.000Z')).build(),
      ]);

      // 1 h < 24 h; had the older run been used, 30 h < 24 h would be false.
      await expect(service.hasRunRecently(JOB, RunMode.AUTO, 24)).resolves.toBe(true);
    });

    it('ignores executions of another job or another run mode', async () => {
      // Both finished 1 h ago, but neither is (import-csv, AUTO).
      const anHourAgo = new Date('2026-01-15T11:00:00.000Z');
      await executions.create([
        aJobExecution().named('scrape-details').finishedAt(anHourAgo).build(),
        aJobExecution().named(JOB).manual().finishedAt(anHourAgo).build(),
      ]);

      await expect(service.hasRunRecently(JOB, RunMode.AUTO, 24)).resolves.toBe(false);
    });

    it('ignores a FAILED run, so the next scheduled run retries', async () => {
      // Failed 1 h ago (11:00Z): within 24 h, but not a run that counts.
      await executions.create(
        aJobExecution()
          .named(JOB)
          .failed()
          .finishedAt(new Date('2026-01-15T11:00:00.000Z'))
          .build(),
      );

      await expect(service.hasRunRecently(JOB, RunMode.AUTO, 24)).resolves.toBe(false);
    });

    it('measures from the last successful run when a later one failed', async () => {
      // Success at 2026-01-14T14:00Z (22 h before now), failure at 11:00Z (1 h before now).
      await executions.create([
        aJobExecution().named(JOB).finishedAt(new Date('2026-01-14T14:00:00.000Z')).build(),
        aJobExecution()
          .named(JOB)
          .failed()
          .finishedAt(new Date('2026-01-15T11:00:00.000Z'))
          .build(),
      ]);

      // 22 h < 23 h -> recent; 22 h < 22 h is false.
      await expect(service.hasRunRecently(JOB, RunMode.AUTO, 23)).resolves.toBe(true);
      await expect(service.hasRunRecently(JOB, RunMode.AUTO, 22)).resolves.toBe(false);
    });

    it('counts a row without a status (written before #36) as a success', async () => {
      await executions.create(
        aJobExecution()
          .named(JOB)
          .legacy()
          .finishedAt(new Date('2026-01-15T11:00:00.000Z'))
          .build(),
      );
      expect((await executions.findOne({ jobName: JOB }).lean())?.status).toBeUndefined();

      await expect(service.hasRunRecently(JOB, RunMode.AUTO, 24)).resolves.toBe(true);
    });
  });

  describe('recordFailure (AR-03)', () => {
    it('records a FAILED run with its code and the injected clock time', async () => {
      const result = await service.recordFailure(JOB, RunMode.AUTO, 'MongoServerError');

      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(result).toEqual({
        jobName: JOB,
        runMode: RunMode.AUTO,
        status: JobStatus.FAILED,
        errorCode: 'MongoServerError',
        finishedAt: NOW,
      });
      for (const persistenceField of ['save', 'toObject', '$__', '_doc', '_id', '__v']) {
        expect(result).not.toHaveProperty(persistenceField);
      }

      const stored = await executions.findOne({ jobName: JOB }).lean();
      expect(stored).toMatchObject({
        jobName: JOB,
        runMode: RunMode.AUTO,
        status: JobStatus.FAILED,
        errorCode: 'MongoServerError',
      });
      expect(stored?.finishedAt.toISOString()).toBe('2026-01-15T12:00:00.000Z');
    });
  });

  describe('getLastOutcome (AR-48)', () => {
    it('is null when the job never ran', async () => {
      await expect(service.getLastOutcome(JOB)).resolves.toBeNull();
    });

    it('is the latest run in any run mode, failed or not', async () => {
      await executions.create([
        aJobExecution().named(JOB).finishedAt(new Date('2026-01-15T03:00:00.000Z')).build(),
        aJobExecution()
          .named(JOB)
          .manual()
          .failed('DownloadError')
          .finishedAt(new Date('2026-01-15T09:00:00.000Z'))
          .build(),
        aJobExecution().named('other-job').finishedAt(new Date('2026-01-15T11:00:00.000Z')).build(),
      ]);

      await expect(service.getLastOutcome(JOB)).resolves.toEqual({
        status: 'FAILED',
        runMode: 'MANUAL',
        finishedAt: new Date('2026-01-15T09:00:00.000Z'),
        errorCode: 'DownloadError',
      });
    });

    it('reads a row without a status as SUCCESS', async () => {
      await executions.create(
        aJobExecution()
          .named(JOB)
          .legacy()
          .finishedAt(new Date('2026-01-15T03:00:00.000Z'))
          .build(),
      );

      await expect(service.getLastOutcome(JOB)).resolves.toEqual({
        status: 'SUCCESS',
        runMode: 'AUTO',
        finishedAt: new Date('2026-01-15T03:00:00.000Z'),
      });
    });
  });

  describe('recordExecution', () => {
    it('stamps the injected clock time, and the window runs from it', async () => {
      const result = await service.recordExecution(JOB, RunMode.MANUAL);

      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(result).toEqual({
        jobName: JOB,
        runMode: RunMode.MANUAL,
        status: JobStatus.SUCCESS,
        finishedAt: NOW,
      });
      for (const persistenceField of ['save', 'toObject', '$__', '_doc', '_id', '__v']) {
        expect(result).not.toHaveProperty(persistenceField);
      }

      const stored = await executions.findOne({ jobName: JOB }).lean();
      expect(stored).toMatchObject({
        jobName: JOB,
        runMode: RunMode.MANUAL,
        status: JobStatus.SUCCESS,
        finishedAt: NOW,
      });

      const last = await service.getLastExecution(JOB, RunMode.MANUAL);
      expect(last).toEqual(result);
      expect(Object.getPrototypeOf(last)).toBe(Object.prototype);
      expect(last?.finishedAt.toISOString()).toBe('2026-01-15T12:00:00.000Z');
      expect(last?.status).toBe(JobStatus.SUCCESS);

      // 23 h 59 min later (2026-01-16T11:59Z): still within 24 h.
      clock.advance(23 * HOUR + 59 * MINUTE);
      await expect(service.hasRunRecently(JOB, RunMode.MANUAL, 24)).resolves.toBe(true);

      // 1 more minute: exactly 24 h, no longer < 24 h.
      clock.advance(MINUTE);
      await expect(service.hasRunRecently(JOB, RunMode.MANUAL, 24)).resolves.toBe(false);
    });
  });
});
