// The cleanup pass as a whole: the startup switch, batching and grouping, the tally of removed,
// retained and failed auctions, and a failing query. Storage is faked (TS-03), the groups' pause
// runs on fake timers (TS-06: nothing sleeps), and the log is read through a spy.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuctionCleanupService } from './auction-cleanup.service.js';
import { FakeClock } from '../../../test/fakes/fake-clock.js';
import { spyOnLogger } from '../../../test/support/logger-spy.js';
import { testBusinessConfig } from '../../../test/support/test-env.js';

type Deps = ConstructorParameters<typeof AuctionCleanupService>;

interface Candidate {
  _id: string;
  code: string;
  image?: { storageKey: string };
}

const withImage = (n: number): Candidate => ({
  _id: `id-${n}`,
  code: `A${n}`,
  image: { storageKey: `images/A${n}.jpg` },
});

function build(
  found: Candidate[] | Error,
  opts: { onStartup?: boolean; deleteFile?: (key: string) => Promise<boolean> } = {},
) {
  const lean = vi.fn(() =>
    found instanceof Error ? Promise.reject(found) : Promise.resolve(found),
  );
  const auctionModel = {
    find: vi.fn().mockReturnValue({ lean }),
    deleteOne: vi.fn().mockResolvedValue({}),
  };
  const storage = {
    isConfigured: vi.fn().mockReturnValue(true),
    deleteFile: vi.fn(opts.deleteFile ?? (() => Promise.resolve(true))),
  };
  const service = new AuctionCleanupService(
    auctionModel as unknown as Deps[0],
    storage as unknown as Deps[1],
    { cleanup: { onStartup: opts.onStartup ?? false } } as unknown as Deps[2],
    testBusinessConfig(),
    new FakeClock(),
  );
  return { service, auctionModel, storage };
}

/** Runs a full pass, letting the fake timers release each pause between groups. */
async function runToEnd(service: AuctionCleanupService): Promise<void> {
  const done = service['runCleanup']();
  await vi.runAllTimersAsync();
  await done;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AuctionCleanupService.onModuleInit', () => {
  it('schedules a pass ten seconds after start when CLEANUP_ON_STARTUP is on', async () => {
    const logger = spyOnLogger();
    const { service, auctionModel } = build([], { onStartup: true });

    await service.onModuleInit();
    expect(auctionModel.find).not.toHaveBeenCalled(); // not at boot: the app is still starting
    await vi.advanceTimersByTimeAsync(9_999);
    expect(auctionModel.find).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(auctionModel.find).toHaveBeenCalledTimes(1);
    expect(logger.loggedText()).toContain('Running cleanup on startup');
  });

  it('does nothing when CLEANUP_ON_STARTUP is off', async () => {
    const logger = spyOnLogger();
    const { service, auctionModel } = build([], { onStartup: false });

    await service.onModuleInit();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(auctionModel.find).not.toHaveBeenCalled();
    expect(logger.loggedText()).toContain('Cleanup disabled');
  });
});

describe('AuctionCleanupService.runCleanup', () => {
  it('asks only for unavailable auctions that still hold a copied file', async () => {
    const { service, auctionModel } = build([]);

    await runToEnd(service);

    const query = auctionModel.find.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(query['available']).toBe(false);
    expect(Object.keys(query).sort()).toEqual(['$or', 'available', 'updatedAt']);
  });

  it('stops quietly when nothing is old enough', async () => {
    const logger = spyOnLogger();
    const { service, storage, auctionModel } = build([]);

    await runToEnd(service);

    expect(logger.loggedText()).toContain('No auctions to clean up');
    expect(storage.deleteFile).not.toHaveBeenCalled();
    expect(auctionModel.deleteOne).not.toHaveBeenCalled();
  });

  it('removes every auction and its files, and tallies them', async () => {
    const logger = spyOnLogger();
    const { service, storage, auctionModel } = build([withImage(1), withImage(2)]);

    await runToEnd(service);

    expect(storage.deleteFile.mock.calls.map(([key]) => key)).toEqual([
      'images/A1.jpg',
      'images/A2.jpg',
    ]);
    expect(auctionModel.deleteOne).toHaveBeenCalledTimes(2);
    expect(logger.loggedText()).toContain(
      'Cleanup completed: 2 auctions removed, 2 files deleted, 0 retained for retry, 0 errors',
    );
  });

  it('works through 20 auctions in batches of 15 and groups of 3, pausing between groups', async () => {
    const logger = spyOnLogger();
    const auctions = Array.from({ length: 20 }, (_, i) => withImage(i + 1));
    const { service, auctionModel } = build(auctions);

    await runToEnd(service);

    // 20 auctions = batch 1 of 15 (5 groups) + batch 2 of 5 (2 groups).
    expect(logger.loggedText()).toContain('Processing batch 1/2');
    expect(logger.loggedText()).toContain('Processing batch 2/2');
    expect(auctionModel.deleteOne).toHaveBeenCalledTimes(20);
    expect(logger.loggedText()).toContain('20 auctions removed, 20 files deleted');
  });

  it('pauses 500 ms after each group of three before starting the next', async () => {
    const auctions = Array.from({ length: 4 }, (_, i) => withImage(i + 1));
    const { service, storage } = build(auctions);

    const done = service['runCleanup']();
    await vi.advanceTimersByTimeAsync(0);
    expect(storage.deleteFile).toHaveBeenCalledTimes(3); // first group only
    await vi.advanceTimersByTimeAsync(499);
    expect(storage.deleteFile).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(storage.deleteFile).toHaveBeenCalledTimes(4); // second group started after 500 ms
    await vi.runAllTimersAsync();
    await done;
  });

  it('keeps an auction whose file could not be deleted and counts it as retained', async () => {
    const logger = spyOnLogger();
    const { service, auctionModel } = build([withImage(1), withImage(2)], {
      deleteFile: async (key) => key !== 'images/A2.jpg',
    });

    await runToEnd(service);

    expect(auctionModel.deleteOne).toHaveBeenCalledTimes(1);
    expect(logger.loggedText()).toContain(
      'Cleanup completed: 1 auctions removed, 1 files deleted, 1 retained for retry, 0 errors',
    );
  });

  it('counts an auction whose processing throws as an error and carries on with the others', async () => {
    const logger = spyOnLogger();
    const { service, auctionModel } = build([withImage(1), withImage(2)]);
    auctionModel.deleteOne.mockRejectedValueOnce(new Error('write failed'));

    await runToEnd(service);

    expect(auctionModel.deleteOne).toHaveBeenCalledTimes(2);
    expect(logger.loggedText()).toContain('Error cleaning auction A1: write failed');
    // The failed auction's own file deletion is not counted: its tally is lost with the rejection.
    expect(logger.loggedText()).toContain(
      'Cleanup completed: 1 auctions removed, 1 files deleted, 0 retained for retry, 1 errors',
    );
  });

  it('logs and ends the pass when the query itself fails', async () => {
    const logger = spyOnLogger();
    const { service, storage } = build(new Error('mongo down'));

    await runToEnd(service);

    expect(logger.loggedText()).toContain('Cleanup failed: mongo down');
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });
});
