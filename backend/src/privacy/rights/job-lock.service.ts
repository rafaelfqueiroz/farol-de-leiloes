// SPEC-010 (AR-03): the run-level lock of the privacy jobs, so two replicas never both run the purge
// or the export worker. A lease: a run that died leaves a lock that simply expires.
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import { JobLockRepository } from './job-lock.repository.js';

@Injectable()
export class JobLockService {
  constructor(
    private readonly locks: JobLockRepository,
    private readonly clock: Clock, // AR-24
  ) {}

  /**
   * Runs `work` while holding the lock `name` for at most `leaseMs`; answers its result, or `null`
   * without running it when another instance holds the lock. The lock is released afterwards
   * whatever `work` did, and a release failure never hides the work's own outcome.
   */
  async runLocked<T>(
    name: string,
    leaseMs: number,
    work: () => Promise<T>,
  ): Promise<{ ran: true; result: T } | { ran: false }> {
    const token = randomUUID();
    const now = this.clock.now();
    if (!(await this.locks.tryAcquire(name, token, now, new Date(now.getTime() + leaseMs)))) {
      return { ran: false };
    }
    try {
      return { ran: true, result: await work() };
    } finally {
      await this.locks.release(name, token).catch(() => undefined);
    }
  }
}
