// The rest of AuctionsService below the database (TS-01): what the import upsert skips, the page
// the list query cuts, the by-code reads, the neighborhoods cache and the availability sweep.
// The model and the cache are stand-ins (FakeQuery for the chains, TS-03); TS-07: Caixa is never
// reached, so the page check (fetchAndCheckAvailability, which drives a browser and has no port)
// is the one vi.mock here. Time is a FakeClock (TS-06) and the pause between groups runs on fake
// timers. The real queries are covered by test/integration.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { AuctionsService } from './auctions.service.js';
import { fetchAndCheckAvailability } from './scraper/details-scraper.js';
import { missingFromListFilter } from './utils/job-queries.js';
import { PhaseModality } from './schemas/auction.schema.js';
import { serverOperators } from '../common/mongo/query-safety.js';
import { Decimal } from '../common/money/money.js';
import { DAY, FakeClock } from '../../test/fakes/fake-clock.js';
import { FakeQuery } from '../../test/fakes/fake-query.js';
import { spyOnLogger } from '../../test/support/logger-spy.js';

vi.mock('./scraper/details-scraper.js', () => ({ fetchAndCheckAvailability: vi.fn() }));

type Deps = ConstructorParameters<typeof AuctionsService>;

const NOW = new Date('2026-01-15T12:00:00.000Z');
const d128 = (value: string) => Types.Decimal128.fromString(value);

function build(
  repo: Record<string, unknown> = {},
  cache: Record<string, unknown> = {},
  cacheOn = false,
) {
  const configService = {
    get: vi.fn().mockReturnValue(cacheOn ? { cache: { neighborhoodsEnabled: true } } : undefined),
  };
  const service = new AuctionsService(
    repo as unknown as Deps[0],
    cache as unknown as Deps[1],
    configService as unknown as Deps[2],
    new FakeClock(NOW),
  );
  return { service, repo, cache };
}

const phase = (modality: PhaseModality, minimumPrice: Decimal | null = null) => ({
  modality,
  minimumPrice,
});

describe('AuctionsService.upsertMany skips', () => {
  function upsertRepo(existing: unknown[] = []) {
    return {
      find: vi.fn().mockReturnValue(new FakeQuery(existing)),
      bulkWrite: vi.fn().mockResolvedValue({ matchedCount: 2, upsertedCount: 3, modifiedCount: 4 }),
    };
  }

  it('answers zeros for an empty list without touching the database', async () => {
    const repo = upsertRepo();

    await expect(build(repo).service.upsertMany([])).resolves.toEqual({
      matched: 0,
      upserted: 0,
      modified: 0,
    });
    expect(repo.find).not.toHaveBeenCalled();
    expect(repo.bulkWrite).not.toHaveBeenCalled();
  });

  it('skips items with no code or no phases, and writes nothing when nothing is left', async () => {
    const repo = upsertRepo();

    const result = await build(repo).service.upsertMany([
      { phases: [phase(PhaseModality.ONLINE_SALES)] }, // no code
      { code: 'A1' }, // no phases field
      { code: 'A2', phases: [] },
    ]);

    expect(result).toEqual({ matched: 0, upserted: 0, modified: 0 });
    expect(repo.bulkWrite).not.toHaveBeenCalled();
  });

  it('looks up only the codes it was given', async () => {
    const repo = upsertRepo();

    await build(repo).service.upsertMany([
      { code: 'A1', phases: [phase(PhaseModality.ONLINE_SALES)] },
      { phases: [phase(PhaseModality.ONLINE_SALES)] },
    ]);

    expect(repo.find).toHaveBeenCalledWith({ code: serverOperators({ $in: ['A1'] }) });
  });

  it('leaves an existing auction alone when its modality has not changed', async () => {
    const repo = upsertRepo([
      { code: 'A1', phases: [{ modality: PhaseModality.ONLINE_SALES, minimumPrice: d128('1') }] },
    ]);

    const result = await build(repo).service.upsertMany([
      { code: 'A1', phases: [phase(PhaseModality.ONLINE_SALES, new Decimal('2'))] },
    ]);

    expect(result).toEqual({ matched: 0, upserted: 0, modified: 0 });
    expect(repo.bulkWrite).not.toHaveBeenCalled();
  });

  it('adds a phase to an existing auction that had none stored', async () => {
    const repo = upsertRepo([{ code: 'A1' }]);

    await build(repo).service.upsertMany([
      { code: 'A1', phases: [phase(PhaseModality.SFI_AUCTION)] },
    ]);

    const [ops] = repo.bulkWrite.mock.calls[0] as [
      { updateOne: { filter: unknown; update: { $set: { phases: unknown[] } } } }[],
    ];
    expect(ops[0]?.updateOne.filter).toEqual({ code: 'A1' });
    expect(ops[0]?.updateOne.update.$set.phases).toEqual([
      { modality: PhaseModality.SFI_AUCTION, minimumPrice: null },
    ]);
  });

  it('writes the inserts and updates unordered and reports the driver counts', async () => {
    const repo = upsertRepo([{ code: 'OLD', phases: [phase(PhaseModality.ONLINE_SALES)] }]);

    const result = await build(repo).service.upsertMany([
      { code: 'NEW', title: 'Casa', phases: [phase(PhaseModality.SFI_AUCTION)], detailsUrl: 'u' },
      { code: 'OLD', phases: [phase(PhaseModality.SFI_AUCTION)] },
    ]);

    expect(result).toEqual({ matched: 2, upserted: 3, modified: 4 });
    const [ops, options] = repo.bulkWrite.mock.calls[0] ?? [];
    expect(options).toEqual({ ordered: false });
    expect(Object.keys((ops as object[])[0] ?? {})).toEqual(['insertOne']);
    expect(Object.keys((ops as object[])[1] ?? {})).toEqual(['updateOne']);
  });
});

describe('AuctionsService.query paging', () => {
  it('counts every match and cuts the requested page, newest first with _id breaking ties', async () => {
    const doc = {
      code: 'A1',
      updatedAt: NOW,
      phases: [{ modality: PhaseModality.ONLINE_SALES, minimumPrice: d128('100.5') }],
    };
    const found = new FakeQuery([doc]);
    const counted = new FakeQuery(41);
    const repo = {
      countDocuments: vi.fn().mockReturnValue(counted),
      find: vi.fn().mockReturnValue(found),
    };

    const page = await build(repo).service.query({}, { page: 3, pageSize: 20 });

    // Page 3 of 20 skips (3 - 1) * 20 = 40 documents.
    expect(repo.countDocuments).toHaveBeenCalledWith({ available: true });
    expect(found.calls['sort']).toEqual([[{ updatedAt: -1, _id: -1 }]]);
    expect(found.calls['skip']).toEqual([[40]]);
    expect(found.calls['limit']).toEqual([[20]]);
    expect(page).toMatchObject({ total: 41, page: 3, pageSize: 20 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.code).toBe('A1');
    expect(page.items[0]?.currentPhase?.minimumPrice?.toString()).toBe('100.5');
  });
});

describe('AuctionsService.findAvailableByCodes', () => {
  it('answers nothing for an empty list without querying', async () => {
    const repo = { find: vi.fn() };
    await expect(build(repo).service.findAvailableByCodes([])).resolves.toEqual([]);
    expect(repo.find).not.toHaveBeenCalled();
  });

  it('maps the available auctions among the codes', async () => {
    const repo = {
      find: vi.fn().mockReturnValue(new FakeQuery([{ code: 'A1', updatedAt: NOW }])),
    };

    const auctions = await build(repo).service.findAvailableByCodes(['A1', 'A2']);

    expect(repo.find).toHaveBeenCalledWith({
      code: serverOperators({ $in: ['A1', 'A2'] }),
      available: true,
    });
    expect(auctions.map((a) => a.code)).toEqual(['A1']);
  });
});

describe('AuctionsService.findActiveCodes edge', () => {
  it('answers an empty set for an empty list without querying', async () => {
    const repo = { find: vi.fn() };
    await expect(build(repo).service.findActiveCodes([])).resolves.toEqual(new Set());
    expect(repo.find).not.toHaveBeenCalled();
  });
});

describe('AuctionsService reads for other modules', () => {
  it('findByCode maps the auction it finds and answers null for none', async () => {
    const repo = { findOne: vi.fn() };
    const { service } = build(repo);
    repo.findOne.mockReturnValueOnce(new FakeQuery({ code: 'A1', updatedAt: NOW }));
    repo.findOne.mockReturnValueOnce(new FakeQuery(null));

    await expect(service.findByCode('A1')).resolves.toMatchObject({ code: 'A1', available: true });
    await expect(service.findByCode('A2')).resolves.toBeNull();
  });

  it('getAllCodes lists the available auctions, newest update first, as code and date only', async () => {
    const query = new FakeQuery([{ code: 'A1', updatedAt: NOW, title: 'not exposed' }]);
    const repo = { find: vi.fn().mockReturnValue(query) };

    await expect(build(repo).service.getAllCodes()).resolves.toEqual([
      { code: 'A1', updatedAt: NOW },
    ]);
    expect(repo.find).toHaveBeenCalledWith({ available: true });
    expect(query.calls['select']).toEqual([['code updatedAt']]);
    expect(query.calls['sort']).toEqual([[{ updatedAt: -1 }]]);
  });

  it('toAuction maps a stored record the way the list does', () => {
    const auction = build().service.toAuction({
      code: 'A1',
      updatedAt: NOW,
      image: { originalUrl: 'https://caixa.test/i.jpg', mimeType: 'image/jpeg' },
    });

    expect(auction).toMatchObject({
      code: 'A1',
      imageUrl: 'https://caixa.test/i.jpg',
      available: true,
      fulfilled: false,
      editalUrl: null,
    });
  });
});

describe('AuctionsService.getNeighborhoods', () => {
  const aggregateOf = (ids: unknown[]) => ({
    aggregate: vi.fn().mockReturnValue(new FakeQuery(ids.map((_id) => ({ _id })))),
  });

  it('lists the distinct neighborhoods of one city as a case-insensitive literal prefix, sorted', async () => {
    const repo = aggregateOf(['CENTRO', 'JARDIM', '', null]);

    const result = await build(repo).service.getNeighborhoods('sp', ['São Paulo (SP)']);

    expect(result).toEqual(['CENTRO', 'JARDIM']);
    const [pipeline] = repo.aggregate.mock.calls[0] as [
      [{ $match: Record<string, unknown> }, unknown, unknown],
    ];
    expect(pipeline[0].$match['available']).toBe(true);
    expect(pipeline[0].$match['address.state']).toBe('SP');
    expect(pipeline[0].$match['address.neighborhood']).toEqual({ $exists: true, $nin: [null, ''] });
    // The parentheses are escaped: the text is literal, not a pattern.
    expect(pipeline[0].$match['address.city']).toEqual(/^São Paulo \(SP\)/i);
    expect(pipeline[1]).toEqual({ $group: { _id: '$address.neighborhood' } });
    expect(pipeline[2]).toEqual({ $sort: { _id: 1 } });
  });

  it('matches several cities with $in of prefixes', async () => {
    const repo = aggregateOf([]);

    await build(repo).service.getNeighborhoods('rj', ['Rio', 'Niterói']);

    const [pipeline] = repo.aggregate.mock.calls[0] as [[{ $match: Record<string, unknown> }]];
    expect(pipeline[0].$match['address.city']).toEqual({ $in: [/^Rio/i, /^Niterói/i] });
  });

  it('does not read or write the cache when it is disabled', async () => {
    const cache = { get: vi.fn(), set: vi.fn() };

    await build(aggregateOf(['A']), cache, false).service.getNeighborhoods('SP', ['X']);

    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('answers from the cache on a hit, without the database', async () => {
    const repo = aggregateOf([]);
    const cache = { get: vi.fn().mockResolvedValue(['CACHED']), set: vi.fn() };

    await expect(
      build(repo, cache, true).service.getNeighborhoods('sp', ['B', 'A']),
    ).resolves.toEqual(['CACHED']);

    // The key is stable across the order the cities came in.
    expect(cache.get).toHaveBeenCalledWith('neighborhoods:SP:A,B');
    expect(repo.aggregate).not.toHaveBeenCalled();
  });

  it('queries and then caches on a miss', async () => {
    const repo = aggregateOf(['CENTRO']);
    const cache = { get: vi.fn().mockResolvedValue(undefined), set: vi.fn() };

    await expect(build(repo, cache, true).service.getNeighborhoods('sp', ['A'])).resolves.toEqual([
      'CENTRO',
    ]);

    expect(cache.set).toHaveBeenCalledWith('neighborhoods:SP:A', ['CENTRO']);
  });
});

describe('AuctionsService.invalidateNeighborhoodsCache', () => {
  it('resets the first cache store', async () => {
    const reset = vi.fn().mockResolvedValue(undefined);

    await build({}, { stores: [{ reset }] }).service.invalidateNeighborhoodsCache();

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the store cannot reset', async () => {
    await expect(
      build({}, { stores: [{}] }).service.invalidateNeighborhoodsCache(),
    ).resolves.toBeUndefined();
    await expect(
      build({}, { stores: [] }).service.invalidateNeighborhoodsCache(),
    ).resolves.toBeUndefined();
  });
});

describe('AuctionsService.verifyAvailability', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(fetchAndCheckAvailability).mockReset();
  });

  const missing = (n: number) => ({ code: `A${n}`, detailsUrl: `https://caixa.test/${n}` });

  function sweepRepo(found: unknown[]) {
    const query = new FakeQuery(found);
    return {
      query,
      find: vi.fn().mockReturnValue(query),
      updateOne: vi.fn().mockResolvedValue({}),
    };
  }

  async function sweep(service: AuctionsService, csvCodes: string[]) {
    const done = service.verifyAvailability(csvCodes);
    await vi.runAllTimersAsync();
    return done;
  }

  it('asks for fulfilled, available auctions outside the list not checked in the last 24 hours', async () => {
    const repo = sweepRepo([]);

    await expect(sweep(build(repo).service, ['X1'])).resolves.toEqual({
      checked: 0,
      unavailable: 0,
      errors: 0,
    });

    // The filter itself is proven against MongoDB under sanitizeFilter (job-queries.spec.ts, #100).
    expect(repo.find.mock.calls[0]?.[0]).toEqual(
      missingFromListFilter(['X1'], new Date(NOW.getTime() - DAY)),
    );
    // Oldest check first, at most 1000 a run.
    expect(repo.query.calls['sort']).toEqual([[{ availabilityCheckedAt: 1 }]]);
    expect(repo.query.calls['limit']).toEqual([[1000]]);
    expect(fetchAndCheckAvailability).not.toHaveBeenCalled();
  });

  it('marks an auction Caixa no longer lists as unavailable, and stamps the others as checked', async () => {
    const repo = sweepRepo([missing(1), missing(2)]);
    vi.mocked(fetchAndCheckAvailability).mockImplementation(async (url) => url.endsWith('/2'));

    const result = await sweep(build(repo).service, []);

    expect(result).toEqual({ checked: 2, unavailable: 1, errors: 0 });
    expect(repo.updateOne).toHaveBeenCalledWith(
      { code: 'A1' },
      { $set: { available: false, availabilityCheckedAt: NOW, updatedAt: NOW } },
    );
    expect(repo.updateOne).toHaveBeenCalledWith(
      { code: 'A2' },
      { $set: { availabilityCheckedAt: NOW } },
    );
  });

  it('counts a failed page check as an error, leaves that auction as it was, and goes on', async () => {
    const logger = spyOnLogger();
    const repo = sweepRepo([missing(1), missing(2)]);
    vi.mocked(fetchAndCheckAvailability)
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(true);

    const result = await sweep(build(repo).service, []);

    expect(result).toEqual({ checked: 2, unavailable: 0, errors: 1 });
    expect(repo.updateOne).toHaveBeenCalledTimes(1);
    expect(repo.updateOne).toHaveBeenCalledWith({ code: 'A2' }, expect.anything());
    expect(logger.loggedText()).toContain('Error checking A1: timeout');
  });

  it('counts an auction without a details URL as an error without opening a page', async () => {
    const repo = sweepRepo([{ code: 'A1', detailsUrl: null }]);

    const result = await sweep(build(repo).service, []);

    expect(result).toEqual({ checked: 1, unavailable: 0, errors: 1 });
    expect(fetchAndCheckAvailability).not.toHaveBeenCalled();
  });

  it('checks in groups of three, one second apart', async () => {
    const repo = sweepRepo(Array.from({ length: 4 }, (_, i) => missing(i + 1)));
    vi.mocked(fetchAndCheckAvailability).mockResolvedValue(true);
    const { service } = build(repo);

    const done = service.verifyAvailability([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchAndCheckAvailability).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(999);
    expect(fetchAndCheckAvailability).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchAndCheckAvailability).toHaveBeenCalledTimes(4);
    await vi.runAllTimersAsync();
    await expect(done).resolves.toEqual({ checked: 4, unavailable: 0, errors: 0 });
  });

  it('processes 16 auctions as two batches (15 + 1)', async () => {
    const logger = spyOnLogger();
    const repo = sweepRepo(Array.from({ length: 16 }, (_, i) => missing(i + 1)));
    vi.mocked(fetchAndCheckAvailability).mockResolvedValue(true);

    const result = await sweep(build(repo).service, []);

    expect(result.checked).toBe(16);
    expect(logger.loggedText()).toContain('Processing batch 1/2');
    expect(logger.loggedText()).toContain('Processing batch 2/2');
  });
});
