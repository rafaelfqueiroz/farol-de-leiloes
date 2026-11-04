// AR-03 / AR-46: the details scraper records a failed run with a stable code, in its own job
// context, and the optional startup run never leaves an unhandled rejection behind.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { captureException } from '@sentry/nestjs';
import { logContextFields } from '../../common/observability/log-context';
import { FakeClock } from '../../../test/fakes/fake-clock';
import { AuctionDetailsScraper, DETAILS_SCRAPER_JOB } from './scraper-scheduler';

// TS-03: the Sentry SDK has no port of ours; vi.mock observes what the job reports. Nothing is sent
// either way (TS-07): Sentry is never initialised in tests.
vi.mock('@sentry/nestjs', () => ({ captureException: vi.fn() }));

type Deps = ConstructorParameters<typeof AuctionDetailsScraper>;

class MongoNetworkError extends Error {
  override name = 'MongoNetworkError';
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
  // The query for auctions to scrape fails: the run fails before reaching Caixa (TS-07).
  const auctionModel = {
    find: () => ({ lean: () => Promise.reject(new MongoNetworkError('connection reset')) }),
  };
  const scraper = new AuctionDetailsScraper(
    auctionModel as unknown as Deps[0],
    jobExecutions as unknown as Deps[1],
    {} as Deps[2],
    { scraper: { enabled: true, onStartup } } as Deps[3],
    new FakeClock(),
  );
  return { scraper, jobExecutions, contexts };
}

describe('AuctionDetailsScraper', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records a failed scheduled run as FAILED with the error class, and rethrows', async () => {
    const { scraper, jobExecutions, contexts } = build();

    await expect(scraper.dailyScraperJob()).rejects.toBeInstanceOf(MongoNetworkError);

    expect(jobExecutions.recordFailure).toHaveBeenCalledWith(
      DETAILS_SCRAPER_JOB,
      'AUTO',
      'MongoNetworkError',
    );
    expect(contexts[0]).toEqual({
      correlationId: expect.any(String),
      jobName: DETAILS_SCRAPER_JOB,
    });
  });

  it('logs the stable code, never the message, and reports the failure to Sentry (AR-47)', async () => {
    const { scraper } = build();
    const error = vi.spyOn(Logger.prototype, 'error');

    await expect(scraper.dailyScraperJob()).rejects.toBeInstanceOf(MongoNetworkError);

    expect(error).toHaveBeenCalledWith('Failed scraping: MongoNetworkError');
    expect(JSON.stringify(error.mock.calls)).not.toContain('connection reset');
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(expect.any(MongoNetworkError), {
      tags: { jobName: DETAILS_SCRAPER_JOB },
    });
  });

  it('still rethrows the scraping error when recording the failure fails too', async () => {
    const { scraper } = build({ recordFails: true });
    const error = vi.spyOn(Logger.prototype, 'error');

    await expect(scraper.dailyScraperJob()).rejects.toBeInstanceOf(MongoNetworkError);
    expect(error).toHaveBeenCalledWith('Could not record the failed scraping run: Error');
  });

  it('catches a failed startup run: no unhandled rejection', async () => {
    const { scraper, jobExecutions } = build({ onStartup: true });
    const warn = vi.spyOn(Logger.prototype, 'warn');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      await scraper.onModuleInit();
      await vi.advanceTimersByTimeAsync(5000);
      vi.useRealTimers();
      await new Promise((resolve) => setImmediate(resolve));

      expect(jobExecutions.recordFailure).toHaveBeenCalledWith(
        DETAILS_SCRAPER_JOB,
        'MANUAL',
        'MongoNetworkError',
      );
      expect(warn).toHaveBeenCalledWith(
        'Startup scraper failed; the daily schedule will run it again',
      );
      expect(unhandled).not.toHaveBeenCalled();
      expect(captureException).toHaveBeenCalledWith(expect.any(Error), {
        tags: { jobName: DETAILS_SCRAPER_JOB },
      });
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});
