// AR-03 / AR-46: the import records a failed run with a stable code, each run logs in its own job
// context, and the optional startup run never leaves an unhandled rejection behind.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { logContextFields } from '../../common/observability/log-context';
import { AuctionsImporter, STARTUP_IMPORT_DELAY_MS } from './scheduler';
import { AUCTIONS_IMPORT_JOB } from './import-job';

// TS-03: the Sentry SDK has no port of ours; vi.mock observes what the job reports. Nothing is sent
// either way (TS-07): Sentry is never initialised in tests.
vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

type Deps = ConstructorParameters<typeof AuctionsImporter>;

class DownloadError extends Error {
  override name = 'DownloadError';
}

function build({ onStartup = false, recordFails = false } = {}) {
  const contexts: Record<string, string>[] = [];
  const jobExecutions = {
    hasRunRecently: vi.fn().mockResolvedValue(false),
    recordExecution: vi.fn(),
    recordFailure: vi.fn(async () => {
      contexts.push(logContextFields());
      if (recordFails) throw new Error('database unreachable');
    }),
  };
  const csvCache = {
    // A message that must never be recorded (SC-15): only the class name is.
    resolveCsv: vi.fn().mockRejectedValue(new DownloadError('Failed to download CSV: 403 for x')),
  };
  const importer = new AuctionsImporter(
    {} as Deps[0],
    jobExecutions as unknown as Deps[1],
    csvCache as unknown as Deps[2],
    { import: { enabled: true, onStartup } } as Deps[3],
  );
  return { importer, jobExecutions, contexts };
}

describe('AuctionsImporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a failed scheduled run as FAILED with the error class, and rethrows', async () => {
    const { importer, jobExecutions, contexts } = build();

    await expect(importer.dailyJob()).rejects.toBeInstanceOf(DownloadError);

    expect(jobExecutions.recordFailure).toHaveBeenCalledWith(
      AUCTIONS_IMPORT_JOB,
      'AUTO',
      'DownloadError',
    );
    expect(jobExecutions.recordExecution).not.toHaveBeenCalled();
    expect(contexts[0]).toEqual({
      correlationId: expect.any(String),
      jobName: AUCTIONS_IMPORT_JOB,
    });
  });

  it('logs the stable code, never the message, and reports the failure to Sentry (AR-47)', async () => {
    const { importer } = build();
    const error = vi.spyOn(Logger.prototype, 'error');

    await expect(importer.dailyJob()).rejects.toBeInstanceOf(DownloadError);

    expect(error).toHaveBeenCalledWith('Failed import: DownloadError');
    expect(JSON.stringify(error.mock.calls)).not.toContain('403 for x');
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(expect.any(DownloadError), {
      tags: { jobName: AUCTIONS_IMPORT_JOB },
    });
  });

  it('still rethrows the import error when recording the failure fails too', async () => {
    const { importer } = build({ recordFails: true });
    const error = vi.spyOn(Logger.prototype, 'error');

    await expect(importer.dailyJob()).rejects.toBeInstanceOf(DownloadError);
    expect(error).toHaveBeenCalledWith('Could not record the failed import: Error');
  });

  it('skips the scheduled run when a successful one is recent', async () => {
    const { importer, jobExecutions } = build();
    jobExecutions.hasRunRecently.mockResolvedValue(true);

    await importer.dailyJob();

    expect(jobExecutions.recordFailure).not.toHaveBeenCalled();
  });

  it('catches a failed startup run: recorded and logged, no unhandled rejection', async () => {
    const { importer, jobExecutions, contexts } = build({ onStartup: true });
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await importer.onModuleInit();
      expect(jobExecutions.recordFailure).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(STARTUP_IMPORT_DELAY_MS);
      // Let the rejection handlers settle on the real event loop.
      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));

      expect(jobExecutions.recordFailure).toHaveBeenCalledWith(
        AUCTIONS_IMPORT_JOB,
        'MANUAL',
        'DownloadError',
      );
      expect(contexts[0]?.jobName).toBe(AUCTIONS_IMPORT_JOB);
      expect(warn).toHaveBeenCalledWith(
        'Startup import failed; the daily schedule will run it again',
      );
      expect(unhandled).not.toHaveBeenCalled();
      expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: { jobName: AUCTIONS_IMPORT_JOB },
      });
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
