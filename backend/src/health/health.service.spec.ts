// AR-48: the service decides "up" from the connection state and a ping that answers in time, then
// reads the last import's outcome. The connection is a hand-written stand-in with the three
// members the service uses; time comes from FakeClock (TS-06), and the ping timeout from fake
// timers, so nothing sleeps (TS-01). The 100%-branch decisions themselves are in
// domain/health-report.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { DB_PING_TIMEOUT_MS, HealthService } from './health.service.js';
import { FakeClock, HOUR } from '../../test/fakes/fake-clock.js';
import { aJobExecution } from '../../test/builders/job-execution.builder.js';
import { spyOnLogger } from '../../test/support/logger-spy.js';
import type { JobOutcome } from '../common/job-execution.js';

type Deps = ConstructorParameters<typeof HealthService>;

const NOW = new Date('2026-01-15T12:00:00.000Z');
const CONNECTED = 1;
const DISCONNECTED = 0;

function anOutcome(ageHours: number, failed = false): JobOutcome {
  const record = aJobExecution()
    .finishedAt(new Date(NOW.getTime() - ageHours * HOUR))
    .build();
  return {
    status: failed ? 'FAILED' : 'SUCCESS',
    runMode: record.runMode,
    finishedAt: record.finishedAt,
  };
}

function build(
  connection: { readyState: number; db?: { admin: () => { ping: () => Promise<unknown> } } },
  lastOutcome: () => Promise<JobOutcome | null> = () => Promise.resolve(anOutcome(6)),
) {
  const getLastOutcome = vi.fn(lastOutcome);
  const service = new HealthService(
    connection as unknown as Deps[0],
    { getLastOutcome } as unknown as Deps[1],
    new FakeClock(NOW),
  );
  return { service, getLastOutcome };
}

const pingWith = (ping: () => Promise<unknown>) => ({
  readyState: CONNECTED,
  db: { admin: () => ({ ping }) },
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HealthService.check', () => {
  it('is ok when the database answers and the last import succeeded recently', async () => {
    const { service, getLastOutcome } = build(pingWith(async () => ({ ok: 1 })));

    const report = await service.check();

    expect(report).toEqual({
      status: 'ok',
      database: { status: 'up' },
      lastImport: {
        status: 'SUCCESS',
        finishedAt: '2026-01-15T06:00:00.000Z',
        ageHours: 6,
        stale: false,
      },
    });
    expect(getLastOutcome).toHaveBeenCalledWith('auctions-import');
  });

  it('is degraded when the last import failed', async () => {
    const { service } = build(
      pingWith(async () => ({ ok: 1 })),
      async () => anOutcome(2, true),
    );
    const report = await service.check();
    expect(report.status).toBe('degraded');
    expect(report.lastImport.status).toBe('FAILED');
  });

  it('is degraded and stale when the import never ran', async () => {
    const { service } = build(
      pingWith(async () => ({ ok: 1 })),
      async () => null,
    );
    const report = await service.check();
    expect(report).toMatchObject({
      status: 'degraded',
      lastImport: { status: 'NEVER', stale: true },
    });
  });

  it('is down, without reading the import record, when the connection is not open', async () => {
    const logger = spyOnLogger();
    const { service, getLastOutcome } = build({ readyState: DISCONNECTED });

    const report = await service.check();

    expect(report.status).toBe('down');
    expect(report.database).toEqual({ status: 'down' });
    expect(getLastOutcome).not.toHaveBeenCalled();
    expect(logger.loggedText()).toContain('Database unreachable');
  });

  it('is down when connected but the driver has no database handle', async () => {
    const { service } = build({ readyState: CONNECTED });
    await expect(service.check()).resolves.toMatchObject({ status: 'down' });
  });

  it('is down when the ping fails, and logs a fixed line instead of the driver error', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { service } = build(
      pingWith(async () => {
        throw new Error('connect ECONNREFUSED user:secret@db.internal');
      }),
    );

    const report = await service.check();

    expect(report.database.status).toBe('down');
    expect(warn).toHaveBeenCalledWith('Database unreachable: health reports down');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('secret');
  });

  it('is down when the import record cannot be read after a successful ping', async () => {
    const { service } = build(
      pingWith(async () => ({ ok: 1 })),
      async () => {
        throw new Error('read failed');
      },
    );
    await expect(service.check()).resolves.toMatchObject({
      status: 'down',
      database: { status: 'down' },
    });
  });
});

describe('HealthService ping timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('counts a ping slower than the timeout as the database being down', async () => {
    const { service, getLastOutcome } = build(pingWith(() => new Promise(() => undefined)));

    const pending = service.check();
    await vi.advanceTimersByTimeAsync(DB_PING_TIMEOUT_MS);

    await expect(pending).resolves.toMatchObject({ database: { status: 'down' } });
    expect(getLastOutcome).not.toHaveBeenCalled();
  });

  it('does not leave the timeout timer running after a fast ping', async () => {
    const { service } = build(pingWith(async () => ({ ok: 1 })));

    await service.check();

    expect(vi.getTimerCount()).toBe(0);
  });
});
