// SPEC-010 BR-010-21, AR-03, AR-04, AR-25, AR-46: the document retention job's orchestration over
// hand-written collaborators (TS-03). The real lock and concurrent runs on MongoDB are in
// test/integration/document-retention.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { RunMode } from '../../common/job-execution.js';
import { currentLogContext } from '../../common/observability/log-context.js';
import { spyOnLogger } from '../../../test/support/logger-spy.js';
import { DOCUMENT_RETENTION_JOB, DocumentRetentionJob } from './document-retention.job.js';
import type { RetentionOutcome } from './retention.service.js';

const OUTCOME: RetentionOutcome = { deleted: 2, files: 9, notDue: 0, failed: 0, unrecorded: 0 };

function build(options: { enabled?: boolean; locked?: boolean; outcome?: RetentionOutcome } = {}) {
  const retention = { purgeDue: vi.fn().mockResolvedValue(options.outcome ?? OUTCOME) };
  const locks = {
    runLocked: vi.fn(async (_name: string, _ms: number, work: () => Promise<unknown>) =>
      options.locked === false ? { ran: false } : { ran: true, result: await work() },
    ),
  };
  const jobs = {
    recordExecution: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const job = new DocumentRetentionJob(
    retention as never,
    locks as never,
    jobs as never,
    {
      documentRetention: { enabled: options.enabled ?? true },
    } as never,
  );
  return { job, retention, locks, jobs };
}

describe('AR-04 / AR-46: the schedule', () => {
  it('does nothing when DOCUMENT_RETENTION_ENABLED is off', async () => {
    const { job, locks, retention } = build({ enabled: false });

    await job.deleteDaily();

    expect(locks.runLocked).not.toHaveBeenCalled();
    expect(retention.purgeDue).not.toHaveBeenCalled();
  });

  it('runs inside a job log context named after the job', async () => {
    const { job, retention } = build();
    let seen: string | undefined;
    retention.purgeDue.mockImplementation(() => {
      seen = currentLogContext()?.jobName;
      return Promise.resolve(OUTCOME);
    });

    await job.deleteDaily();

    expect(seen).toBe(DOCUMENT_RETENTION_JOB);
  });
});

describe('run', () => {
  it('runs under the job lock and records one automatic success', async () => {
    const { job, locks, jobs } = build();

    expect(await job.run()).toEqual(OUTCOME);

    expect(locks.runLocked).toHaveBeenCalledWith(
      'job:document-retention',
      expect.any(Number),
      expect.any(Function),
    );
    expect(jobs.recordExecution).toHaveBeenCalledWith(DOCUMENT_RETENTION_JOB, RunMode.AUTO);
    expect(jobs.recordFailure).not.toHaveBeenCalled();
  });

  it('does not run, and records nothing, while another instance holds the lock', async () => {
    const { job, retention, jobs } = build({ locked: false });

    expect(await job.run()).toBeNull();
    expect(retention.purgeDue).not.toHaveBeenCalled();
    expect(jobs.recordExecution).not.toHaveBeenCalled();
    expect(jobs.recordFailure).not.toHaveBeenCalled();
  });

  it('records PARTIAL_FAILURE when a journey failed, and logs only counts', async () => {
    const logger = spyOnLogger();
    const { job, jobs } = build({ outcome: { ...OUTCOME, failed: 1 } });

    await job.run();

    expect(jobs.recordFailure).toHaveBeenCalledWith(
      DOCUMENT_RETENTION_JOB,
      RunMode.AUTO,
      'PARTIAL_FAILURE',
    );
    expect(logger.loggedText()).toContain('2 journeys deleted (9 files)');
  });

  it('warns when the source lists journeys that are not due, and errors on an unrecorded deletion', async () => {
    const logger = spyOnLogger();
    const { job } = build({ outcome: { ...OUTCOME, notDue: 3, failed: 1, unrecorded: 1 } });

    await job.run();

    const logged = logger.loggedText();
    expect(logged).toContain('listed 3 journeys that are not due yet');
    expect(logged).toContain('1 journeys had their files deleted but no log row written');
  });

  it('records the failure code of a run that failed as a whole, and never throws', async () => {
    const logger = spyOnLogger();
    const { job, retention, jobs } = build();
    retention.purgeDue.mockRejectedValue(new TypeError('quotes secret.pdf'));

    expect(await job.run()).toBeNull();

    expect(jobs.recordFailure).toHaveBeenCalledWith(
      DOCUMENT_RETENTION_JOB,
      RunMode.AUTO,
      'TypeError',
    );
    expect(logger.loggedText()).toContain('TypeError');
    expect(logger.loggedText()).not.toContain('secret.pdf');
  });
});
