// SPEC-010 BR-010-15, AR-03, AR-04, AR-25: the purge job's orchestration over hand-written
// collaborators (TS-03). The real claims, races and fault injection on MongoDB are in
// test/integration/account-purge.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { RunMode } from '../../common/job-execution.js';
import { currentLogContext } from '../../common/observability/log-context.js';
import { spyOnLogger } from '../../../test/support/logger-spy.js';
import { DEFAULT_ACCOUNT_PURGE_LIMITS } from '../domain/account-purge.js';
import { FakeClock, DAY } from '../../../test/fakes/fake-clock.js';
import { testBusinessConfig } from '../../../test/support/test-env.js';
import {
  ACCOUNT_PURGE_JOB,
  AccountPurgeJob,
  RESIDUE_SWEEP_MAX_PER_RUN,
} from './account-purge.job.js';

function build(options: { enabled?: boolean; locked?: boolean; overdue?: number } = {}) {
  const clock = new FakeClock();
  const users = {
    findPurgeCandidates: vi.fn().mockResolvedValue([]),
    findResidueSweepCandidates: vi.fn().mockResolvedValue([]),
    markResidueSwept: vi.fn().mockResolvedValue(true),
    deferResidueSweep: vi.fn().mockResolvedValue(undefined),
    claimForPurge: vi.fn().mockResolvedValue(true),
    completePurge: vi.fn().mockResolvedValue(true),
    releasePurgeClaim: vi.fn().mockResolvedValue(undefined),
    countOverduePurges: vi.fn().mockResolvedValue(options.overdue ?? 0),
  };
  const registry = { purge: vi.fn().mockResolvedValue({}) };
  const closure = {
    applyClosureEffects: vi.fn().mockResolvedValue({ failedSteps: [], failedHooks: [] }),
  };
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
    DEFAULT_ACCOUNT_PURGE_LIMITS,
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
    users.findPurgeCandidates.mockResolvedValueOnce(['a', 'b']).mockResolvedValue([]);

    const outcome = await job.run();

    expect(outcome).toEqual({
      purged: 2,
      skipped: 0,
      failed: 0,
      overdue: 0,
      swept: 0,
      residueDeleted: 0,
      sweepFailed: 0,
    });
    expect(closure.applyClosureEffects.mock.calls).toEqual([['a'], ['b']]);
    expect(registry.purge.mock.calls).toEqual([['a'], ['b']]);
    expect(users.completePurge).toHaveBeenCalledTimes(2);
    expect(jobs.recordExecution).toHaveBeenCalledWith(ACCOUNT_PURGE_JOB, RunMode.AUTO);
  });

  it('skips an account another worker holds, and one whose claim was lost before the tombstone', async () => {
    const { job, users } = build();
    users.findPurgeCandidates.mockResolvedValueOnce(['held', 'lost']).mockResolvedValue([]);
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
    users.findPurgeCandidates.mockResolvedValueOnce(['bad', 'good']).mockResolvedValue([]);
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
    users.findPurgeCandidates.mockResolvedValueOnce(['bad']).mockResolvedValue([]);
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
    users.findPurgeCandidates.mockResolvedValueOnce(['a']).mockResolvedValue([]);
    closure.applyClosureEffects.mockResolvedValue({ failedSteps: ['exports'], failedHooks: [] });

    await job.run();

    expect(logger.loggedText()).toContain('exports');
  });
});

describe('BR-010-15: the alert', () => {
  it('asks for the accounts closed 25 days ago or earlier and logs an error with the count only', async () => {
    const logger = spyOnLogger();
    const { job, users, clock } = build({ overdue: 3 });

    expect(await job.checkOverdue()).toBe(3);

    expect(users.countOverduePurges).toHaveBeenCalledWith(
      new Date(clock.now().getTime() - 25 * DAY),
    );
    expect(logger.loggedText()).toContain(
      '3 closed account(s) not purged 25 days after closure; the legal limit is 30 days (BR-010-15)',
    );
  });

  it('is silent with nothing overdue', async () => {
    const logger = spyOnLogger();

    expect(await build().job.checkOverdue()).toBe(0);
    expect(logger.loggedText()).not.toContain('not purged');
  });

  it('runs daily even with ACCOUNT_PURGE_ENABLED off: that is when it matters most', async () => {
    const logger = spyOnLogger();
    const { job, locks } = build({ enabled: false, overdue: 2 });

    await job.purgeDaily();
    await job.checkOverdueDaily();

    expect(locks.runLocked).not.toHaveBeenCalled(); // the purge did not run...
    expect(logger.loggedText()).toContain('2 closed account(s) not purged'); // ...and the alert did
  });

  it('runs in a job log context of its own (AR-46) and never throws', async () => {
    const logger = spyOnLogger();
    const { job, users } = build();
    let seen: string | undefined;
    users.countOverduePurges.mockImplementation(() => {
      seen = currentLogContext()?.jobName;
      return Promise.reject(new RangeError('db'));
    });

    await expect(job.checkOverdueDaily()).resolves.toBeUndefined();

    expect(seen).toBe('account-purge-alert');
    expect(logger.loggedText()).toContain('Account purge overdue check failed: RangeError');
  });

  it('the purge run reports the overdue count in its outcome without logging the alert twice', async () => {
    const logger = spyOnLogger();

    const outcome = await build({ overdue: 4 }).job.run();

    expect(outcome?.overdue).toBe(4);
    expect(logger.loggedText()).not.toContain('not purged');
  });
});

describe('a bad head of the queue never stalls the rest', () => {
  it('leaves an account that failed out of the rest of the run and goes on to the later ones', async () => {
    const { job, users, registry } = build();
    const done = new Set<string>();
    const asked: (readonly string[])[] = [];
    users.findPurgeCandidates.mockImplementation(
      (_now: Date, _limit: number, excluded: readonly string[]) => {
        asked.push([...excluded]);
        return Promise.resolve(
          ['bad', 'good'].filter((id) => !excluded.includes(id) && !done.has(id)),
        );
      },
    );
    registry.purge.mockImplementation((id: string) =>
      id === 'bad' ? Promise.reject(new Error('x')) : Promise.resolve({}),
    );
    users.completePurge.mockImplementation((id: string) => {
      done.add(id);
      return Promise.resolve(true);
    });

    const outcome = await job.run();

    expect(outcome).toMatchObject({ purged: 1, failed: 1 });
    expect(asked[0]).toEqual([]);
    expect(asked[1]).toEqual(['bad']); // not asked for again in this run
  });

  it('stops after the attempts budget even if there is always another candidate', async () => {
    const { job, users } = build();
    let n = 0;
    users.findPurgeCandidates.mockImplementation(() =>
      Promise.resolve(Array.from({ length: 100 }, () => `id-${(n += 1)}`)),
    );

    const outcome = await job.run();

    expect(outcome?.purged).toBe(DEFAULT_ACCOUNT_PURGE_LIMITS.maxAttemptsPerRun);
  });
});

describe('closure hooks must have ended before the tombstone', () => {
  it('a hook that still fails fails the account’s purge: no provider runs after it, no tombstone, claim released', async () => {
    const logger = spyOnLogger();
    const { job, users, registry, closure, jobs } = build();
    users.findPurgeCandidates.mockResolvedValueOnce(['a']).mockResolvedValue([]);
    closure.applyClosureEffects.mockResolvedValue({
      failedSteps: [],
      failedHooks: ['hook-links'],
    });

    expect(await job.run()).toMatchObject({ purged: 0, failed: 1 });

    expect(registry.purge).not.toHaveBeenCalled();
    expect(users.completePurge).not.toHaveBeenCalled();
    expect(users.releasePurgeClaim).toHaveBeenCalledWith('a', expect.any(String));
    expect(jobs.recordFailure).toHaveBeenCalledWith(
      ACCOUNT_PURGE_JOB,
      RunMode.AUTO,
      'PARTIAL_FAILURE',
    );
    expect(logger.loggedText()).toContain('ClosureHookFailedError');
  });
});

describe('BR-010-15: the residue sweep', () => {
  it('runs every provider again for each account whose sweep is due, marks it, and reports counts only', async () => {
    const { job, users, registry, jobs } = build();
    users.findResidueSweepCandidates.mockResolvedValueOnce(['a', 'b']).mockResolvedValue([]);
    registry.purge
      .mockResolvedValueOnce({ favorites: 1, reminders: 2 })
      .mockResolvedValueOnce({ favorites: 0 });

    const outcome = await job.run();

    expect(outcome).toMatchObject({ swept: 2, residueDeleted: 3, sweepFailed: 0 });
    expect(registry.purge.mock.calls).toEqual([['a'], ['b']]);
    expect(users.markResidueSwept.mock.calls.map(([id]) => id)).toEqual(['a', 'b']);
    expect(jobs.recordExecution).toHaveBeenCalledWith(ACCOUNT_PURGE_JOB, RunMode.AUTO);
  });

  it('asks for the sweeps due at the start of the run, so an account purged in this very run waits a day', async () => {
    const { job, users, clock } = build();

    await job.run();

    expect(users.findResidueSweepCandidates).toHaveBeenCalledWith(clock.now(), 100, []);
  });

  it('a failing sweep moves its due instant a day on, is counted, and the others are still swept', async () => {
    const logger = spyOnLogger();
    const { job, users, registry, jobs, clock } = build();
    users.findResidueSweepCandidates.mockResolvedValueOnce(['bad', 'good']).mockResolvedValue([]);
    registry.purge.mockRejectedValueOnce(new TypeError('quotes ana@example.test'));

    const outcome = await job.run();

    expect(outcome).toMatchObject({ swept: 1, sweepFailed: 1 });
    expect(users.deferResidueSweep).toHaveBeenCalledWith(
      'bad',
      new Date(clock.now().getTime() + DAY),
    );
    expect(users.markResidueSwept).toHaveBeenCalledTimes(1);
    expect(jobs.recordFailure).toHaveBeenCalledWith(
      ACCOUNT_PURGE_JOB,
      RunMode.AUTO,
      'PARTIAL_FAILURE',
    );
    expect(logger.loggedText()).toContain('TypeError');
    expect(logger.loggedText()).not.toContain('ana@example.test');
  });

  it('a deferral that fails too does not hide the failure or stop the run', async () => {
    const { job, users, registry } = build();
    users.findResidueSweepCandidates.mockResolvedValueOnce(['bad']).mockResolvedValue([]);
    registry.purge.mockRejectedValue(new Error('x'));
    users.deferResidueSweep.mockRejectedValue(new Error('y'));

    expect(await job.run()).toMatchObject({ sweepFailed: 1 });
  });

  it('stops after its own attempts budget, each account asked for once per run', async () => {
    const { job, users } = build();
    let n = 0;
    users.findResidueSweepCandidates.mockImplementation(
      (_now: Date, _limit: number, excluded: readonly string[]) => {
        expect(new Set(excluded).size).toBe(excluded.length);
        return Promise.resolve(Array.from({ length: 100 }, () => `id-${(n += 1)}`));
      },
    );

    const outcome = await job.run();

    expect(outcome?.swept).toBe(RESIDUE_SWEEP_MAX_PER_RUN);
  });

  it('an account another run already marked is not counted as swept', async () => {
    const { job, users } = build();
    users.findResidueSweepCandidates.mockResolvedValueOnce(['a']).mockResolvedValue([]);
    users.markResidueSwept.mockResolvedValue(false);

    expect(await job.run()).toMatchObject({ swept: 0, sweepFailed: 0 });
  });
});
