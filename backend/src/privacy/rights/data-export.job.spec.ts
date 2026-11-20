// SPEC-010 BR-010-11, AR-03, AR-04: the export schedules over hand-written collaborators (TS-03).
import { describe, expect, it, vi } from 'vitest';
import { RunMode } from '../../common/job-execution.js';
import { currentLogContext } from '../../common/observability/log-context.js';
import { DATA_EXPORT_BUILD_JOB, DATA_EXPORT_EXPIRY_JOB, DataExportJob } from './data-export.job.js';

function build(options: { enabled?: boolean; locked?: boolean; hasWork?: boolean } = {}) {
  const worker = {
    hasWork: vi.fn().mockResolvedValue(options.hasWork ?? true),
    processQueued: vi.fn().mockResolvedValue({ ready: 1, failed: 0, discarded: 0 }),
    expireDue: vi.fn().mockResolvedValue({ expired: 1, cleaned: 0, failed: 0 }),
  };
  const locks = {
    runLocked: vi.fn(async (_n: string, _ms: number, work: () => Promise<unknown>) =>
      options.locked === false ? { ran: false } : { ran: true, result: await work() },
    ),
  };
  const jobs = {
    recordExecution: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const job = new DataExportJob(
    worker as never,
    locks as never,
    jobs as never,
    {
      dataExport: { enabled: options.enabled ?? true },
    } as never,
  );
  return { job, worker, locks, jobs };
}

describe('AR-04: DATA_EXPORT_ENABLED', () => {
  it('off: neither schedule does anything', async () => {
    const { job, worker, locks } = build({ enabled: false });

    await job.buildQueued();
    await job.expire();

    expect(worker.hasWork).not.toHaveBeenCalled();
    expect(locks.runLocked).not.toHaveBeenCalled();
  });

  it('on: each schedule runs in a job log context named after it (AR-46)', async () => {
    const { job, worker } = build();
    const seen: (string | undefined)[] = [];
    worker.hasWork.mockImplementation(() => {
      seen.push(currentLogContext()?.jobName);
      return Promise.resolve(false);
    });
    worker.expireDue.mockImplementation(() => {
      seen.push(currentLogContext()?.jobName);
      return Promise.resolve({ expired: 0, cleaned: 0, failed: 0 });
    });

    await job.buildQueued();
    await job.expire();

    expect(seen).toEqual([DATA_EXPORT_BUILD_JOB, DATA_EXPORT_EXPIRY_JOB]);
  });
});

describe('runBuild', () => {
  it('builds and records one run', async () => {
    const { job, jobs } = build();

    expect(await job.runBuild()).toEqual({ ready: 1, failed: 0, discarded: 0 });
    expect(jobs.recordExecution).toHaveBeenCalledWith(DATA_EXPORT_BUILD_JOB, RunMode.AUTO);
  });

  it('with nothing queued it takes no lock and records nothing', async () => {
    const { job, locks, jobs } = build({ hasWork: false });

    expect(await job.runBuild()).toBeNull();
    expect(locks.runLocked).not.toHaveBeenCalled();
    expect(jobs.recordExecution).not.toHaveBeenCalled();
  });

  it('a run that found the exports gone records nothing', async () => {
    const { job, worker, jobs } = build();
    worker.processQueued.mockResolvedValue({ ready: 0, failed: 0, discarded: 0 });

    await job.runBuild();

    expect(jobs.recordExecution).not.toHaveBeenCalled();
  });

  it('skips while another instance holds the lock', async () => {
    const { job, worker } = build({ locked: false });

    expect(await job.runBuild()).toBeNull();
    expect(worker.processQueued).not.toHaveBeenCalled();
  });

  it('records a failure by code and answers null, never throwing', async () => {
    const { job, worker, jobs } = build();
    worker.processQueued.mockRejectedValue(new TypeError('x'));

    expect(await job.runBuild()).toBeNull();
    expect(jobs.recordFailure).toHaveBeenCalledWith(
      DATA_EXPORT_BUILD_JOB,
      RunMode.AUTO,
      'TypeError',
    );
  });
});

describe('runExpiry', () => {
  it('records a success when it expired something', async () => {
    const { job, jobs } = build();

    expect(await job.runExpiry()).toEqual({ expired: 1, cleaned: 0, failed: 0 });
    expect(jobs.recordExecution).toHaveBeenCalledWith(DATA_EXPORT_EXPIRY_JOB, RunMode.AUTO);
  });

  it('records PARTIAL_FAILURE when a file could not be deleted', async () => {
    const { job, worker, jobs } = build();
    worker.expireDue.mockResolvedValue({ expired: 0, cleaned: 0, failed: 2 });

    await job.runExpiry();

    expect(jobs.recordFailure).toHaveBeenCalledWith(
      DATA_EXPORT_EXPIRY_JOB,
      RunMode.AUTO,
      'PARTIAL_FAILURE',
    );
  });

  it('records nothing when there was nothing to do', async () => {
    const { job, worker, jobs } = build();
    worker.expireDue.mockResolvedValue({ expired: 0, cleaned: 0, failed: 0 });

    await job.runExpiry();

    expect(jobs.recordExecution).not.toHaveBeenCalled();
    expect(jobs.recordFailure).not.toHaveBeenCalled();
  });

  it('skips while locked, and records a thrown failure by code', async () => {
    expect(await build({ locked: false }).job.runExpiry()).toBeNull();
    const { job, worker, jobs } = build();
    worker.expireDue.mockRejectedValue(new RangeError('x'));

    expect(await job.runExpiry()).toBeNull();
    expect(jobs.recordFailure).toHaveBeenCalledWith(
      DATA_EXPORT_EXPIRY_JOB,
      RunMode.AUTO,
      'RangeError',
    );
  });
});
