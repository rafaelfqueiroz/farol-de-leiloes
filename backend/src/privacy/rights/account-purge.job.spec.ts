// SPEC-010 BR-010-15, AR-03, AR-04, AR-25: the purge job's orchestration over hand-written
// collaborators (TS-03). The real claims, races and fault injection on MongoDB are in
// test/integration/account-purge.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { RunMode } from '../../common/job-execution.js';
import { currentLogContext } from '../../common/observability/log-context.js';
import { spyOnLogger } from '../../../test/support/logger-spy.js';
import { FakeClock, DAY } from '../../../test/fakes/fake-clock.js';
import { testBusinessConfig } from '../../../test/support/test-env.js';
import { ACCOUNT_PURGE_JOB, AccountPurgeJob } from './account-purge.job.js';

function build(options: { enabled?: boolean; locked?: boolean; overdue?: number } = {}) {
  const clock = new FakeClock();
  const users = {
    findPurgeCandidates: vi.fn().mockResolvedValue([]),
    claimForPurge: vi.fn().mockResolvedValue(true),
    completePurge: vi.fn().mockResolvedValue(true),
    releasePurgeClaim: vi.fn().mockResolvedValue(undefined),
    countOverduePurges: vi.fn().mockResolvedValue(options.overdue ?? 0),
  };
  const registry = { purge: vi.fn().mockResolvedValue({}) };
  const closure = { applyClosureEffects: vi.fn().mockResolvedValue([]) };
  const locks = {
    runLocked: vi.fn(async (_name: string, _ms: number, work: () => Promise<unknown>) =>
      options.locked === false ? { ran: false } : { ran: true, result: await work() },
    ),
  };
  const jobs = {
    recordExecution: vi.fn().mockResolvedValue(undefined),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
  const job = new AccountPurgeJob(
    users as never,
    registry as never,
    closure as never,
    locks as never,
    jobs as never,
    clock,
    { accountPurge: { enabled: options.enabled ?? true } } as never,
    testBusinessConfig(),
  );
  return { job, users, registry, closure, locks, jobs, clock };
}

describe('AR-04 / AR-46: the schedule', () => {
  it('does nothing when ACCOUNT_PURGE_ENABLED is off', async () => {
    const { job, locks } = build({ enabled: false });

    await job.purgeDaily();

    expect(locks.runLocked).not.toHaveBeenCalled();
  });

  it('runs inside a job log context named after the job', async () => {
    const { job, users } = build();
    let seen: string | undefined;
    users.findPurgeCandidates.mockImplementation(() => {
      seen = currentLogContext()?.jobName;
      return Promise.resolve([]);
    });

    await job.purgeDaily();

    expect(seen).toBe(ACCOUNT_PURGE_JOB);
  });
});

describe('run', () => {
  it('purges each candidate, oldest first, and records one automatic success', async () => {
    const { job, users, registry, closure, jobs } = build();
    users.findPurgeCandidates.mockResolvedValue(['a', 'b']);

    const outcome = await job.run();

    expect(outcome).toEqual({ purged: 2, skipped: 0, failed: 0, overdue: 0 });
    expect(closure.applyClosureEffects.mock.calls).toEqual([['a'], ['b']]);
    expect(registry.purge.mock.calls).toEqual([['a'], ['b']]);
    expect(users.completePurge).toHaveBeenCalledTimes(2);
    expect(jobs.recordExecution).toHaveBeenCalledWith(ACCOUNT_PURGE_JOB, RunMode.AUTO);
  });

  it('skips an account another worker holds, and one whose claim was lost before the tombstone', async () => {
    const { job, users } = build();
    users.findPurgeCandidates.mockResolvedValue(['held', 'lost']);
    users.claimForPurge.mockResolvedValueOnce(false);
    users.completePurge.mockResolvedValueOnce(false);

    expect(await job.run()).toMatchObject({ purged: 0, skipped: 2, failed: 0 });
  });

  it('does not run, and records nothing, while another instance holds the lock', async () => {
    const { job, jobs, users } = build({ locked: false });

    expect(await job.run()).toBeNull();
    expect(users.findPurgeCandidates).not.toHaveBeenCalled();
    expect(jobs.recordExecution).not.toHaveBeenCalled();
  });

  it('a failing account releases its claim, writes no tombstone, and the run records PARTIAL_FAILURE', async () => {
    const logger = spyOnLogger();
    const { job, users, registry, jobs } = build();
    users.findPurgeCandidates.mockResolvedValue(['bad', 'good']);
    registry.purge.mockRejectedValueOnce(new TypeError('quotes ana@example.test'));

    expect(await job.run()).toMatchObject({ purged: 1, failed: 1 });

    expect(users.releasePurgeClaim).toHaveBeenCalledWith('bad', expect.any(String));
    expect(users.completePurge).toHaveBeenCalledTimes(1);
    expect(jobs.recordFailure).toHaveBeenCalledWith(
      ACCOUNT_PURGE_JOB,
      RunMode.AUTO,
      'PARTIAL_FAILURE',
    );
    expect(logger.loggedText()).toContain('TypeError');
    expect(logger.loggedText()).not.toContain('ana@example.test');
  });

  it('a release that fails too does not hide the original failure', async () => {
    const { job, users, registry } = build();
    users.findPurgeCandidates.mockResolvedValue(['bad']);
    registry.purge.mockRejectedValue(new Error('x'));
    users.releasePurgeClaim.mockRejectedValue(new Error('y'));

    expect(await job.run()).toMatchObject({ failed: 1 });
  });

  it('a failure of the whole run is recorded with its code and answers null', async () => {
    const { job, locks, jobs } = build();
    locks.runLocked.mockRejectedValue(new RangeError('db'));

    expect(await job.run()).toBeNull();
    expect(jobs.recordFailure).toHaveBeenCalledWith(ACCOUNT_PURGE_JOB, RunMode.AUTO, 'RangeError');
  });

  it('logs closure effects that are still incomplete at purge, by name only', async () => {
    const logger = spyOnLogger();
    const { job, users, closure } = build();
    users.findPurgeCandidates.mockResolvedValue(['a']);
    closure.applyClosureEffects.mockResolvedValue(['hook-links']);

    await job.run();

    expect(logger.loggedText()).toContain('hook-links');
  });
});

describe('BR-010-15: the alert', () => {
  it('asks for the accounts closed 25 days ago or earlier and logs an error with the count only', async () => {
    const logger = spyOnLogger();
    const { job, users, clock } = build({ overdue: 3 });

    const outcome = await job.run();

    expect(outcome?.overdue).toBe(3);
    expect(users.countOverduePurges).toHaveBeenCalledWith(
      new Date(clock.now().getTime() - 25 * DAY),
    );
    expect(logger.loggedText()).toContain(
      '3 closed account(s) not purged 25 days after closure; the legal limit is 30 days (BR-010-15)',
    );
  });

  it('is silent with nothing overdue', async () => {
    const logger = spyOnLogger();
    await build().job.run();

    expect(logger.loggedText()).not.toContain('not purged');
  });
});
