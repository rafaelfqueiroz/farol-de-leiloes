// AR-03 / AR-24: what the job-execution service writes, and how it reads the last run back. The
// model is a stand-in with a recording constructor and a chainable query (TS-03, TS-01); the
// real queries are covered by test/integration/job-execution.service.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { JobExecutionService } from './job-execution.service.js';
import { JobStatus, RunMode } from '../job-execution.js';
import { FakeClock, HOUR } from '../../../test/fakes/fake-clock.js';
import { FakeQuery } from '../../../test/fakes/fake-query.js';
import { aJobExecution } from '../../../test/builders/job-execution.builder.js';

type Deps = ConstructorParameters<typeof JobExecutionService>;

const NOW = new Date('2026-01-15T12:00:00.000Z');

function build(found: unknown = null) {
  const created: Record<string, unknown>[] = [];
  const query = new FakeQuery(found);
  class Model {
    constructor(readonly fields: Record<string, unknown>) {
      created.push(fields);
    }
    // Echoes the document back with a persistence field the service must not leak (AR-09).
    save() {
      return Promise.resolve({ ...this.fields, _id: 'internal', __v: 0 });
    }
    static findOne = vi.fn().mockReturnValue(query);
  }
  const service = new JobExecutionService(Model as unknown as Deps[0], new FakeClock(NOW));
  return { service, created, Model, query };
}

describe('JobExecutionService writes', () => {
  it('records a success stamped with the injected clock, as a plain record', async () => {
    const { service, created } = build();

    const record = await service.recordExecution('import-csv', RunMode.AUTO);

    expect(created).toEqual([
      { jobName: 'import-csv', runMode: RunMode.AUTO, status: JobStatus.SUCCESS, finishedAt: NOW },
    ]);
    expect(record).toEqual({
      jobName: 'import-csv',
      runMode: RunMode.AUTO,
      finishedAt: NOW,
      status: JobStatus.SUCCESS,
    });
    expect(record).not.toHaveProperty('_id');
  });

  it('records a failure with its stable code', async () => {
    const { service, created } = build();

    const record = await service.recordFailure('import-csv', RunMode.MANUAL, 'TypeError');

    expect(created[0]).toMatchObject({ status: JobStatus.FAILED, errorCode: 'TypeError' });
    expect(record).toEqual({
      jobName: 'import-csv',
      runMode: RunMode.MANUAL,
      finishedAt: NOW,
      status: JobStatus.FAILED,
      errorCode: 'TypeError',
    });
  });
});

describe('JobExecutionService.getLastExecution', () => {
  it('asks for the newest run of the job in that mode that did not fail', async () => {
    const stored = aJobExecution().named('import-csv').build();
    const { service, Model, query } = build(stored);

    await expect(service.getLastExecution('import-csv', RunMode.AUTO)).resolves.toEqual(stored);

    // A legacy row has no status and counts as a success, hence $ne FAILED.
    expect(Model.findOne).toHaveBeenCalledWith({
      jobName: 'import-csv',
      runMode: RunMode.AUTO,
      status: { $ne: JobStatus.FAILED },
    });
    expect(query.calls['sort']).toEqual([[{ finishedAt: -1 }]]);
  });

  it('answers null when the job never ran', async () => {
    await expect(build(null).service.getLastExecution('x', RunMode.AUTO)).resolves.toBeNull();
  });

  it('returns a legacy row without inventing a status', async () => {
    const legacy = aJobExecution().legacy().build();
    const record = await build(legacy).service.getLastExecution('test-job', RunMode.AUTO);
    expect(record).not.toHaveProperty('status');
    expect(record).not.toHaveProperty('errorCode');
  });
});

describe('JobExecutionService.getLastOutcome', () => {
  it('answers null when the job never ran', async () => {
    await expect(build(null).service.getLastOutcome('x')).resolves.toBeNull();
  });

  it('reads a legacy row without a status as a success', async () => {
    const legacy = aJobExecution().legacy().build();
    await expect(build(legacy).service.getLastOutcome('test-job')).resolves.toEqual({
      status: 'SUCCESS',
      runMode: legacy.runMode,
      finishedAt: legacy.finishedAt,
    });
  });

  it('carries the error code of a failed run', async () => {
    const failed = aJobExecution().failed('TypeError').build();
    await expect(build(failed).service.getLastOutcome('test-job')).resolves.toEqual({
      status: 'FAILED',
      runMode: failed.runMode,
      finishedAt: failed.finishedAt,
      errorCode: 'TypeError',
    });
  });

  it('looks across run modes: the filter names only the job', async () => {
    const { service, Model } = build(aJobExecution().build());
    await service.getLastOutcome('test-job');
    expect(Model.findOne).toHaveBeenCalledWith({ jobName: 'test-job' });
  });
});

describe('JobExecutionService.hasRunRecently (AR-24, TS-06)', () => {
  const ranHoursAgo = (hours: number) =>
    aJobExecution()
      .finishedAt(new Date(NOW.getTime() - hours * HOUR))
      .build();

  it('is false when the job never succeeded', async () => {
    await expect(build(null).service.hasRunRecently('x', RunMode.AUTO, 24)).resolves.toBe(false);
  });

  it('is true when the last success is inside the window', async () => {
    const { service } = build(ranHoursAgo(23));
    await expect(service.hasRunRecently('x', RunMode.AUTO, 24)).resolves.toBe(true);
  });

  it('is false exactly at the window edge and beyond it', async () => {
    await expect(
      build(ranHoursAgo(24)).service.hasRunRecently('x', RunMode.AUTO, 24),
    ).resolves.toBe(false);
    await expect(
      build(ranHoursAgo(48)).service.hasRunRecently('x', RunMode.AUTO, 24),
    ).resolves.toBe(false);
  });
});
