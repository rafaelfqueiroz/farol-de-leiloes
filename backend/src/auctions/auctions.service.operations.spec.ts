// The rest of AuctionsService below the database (TS-01): the page the list query cuts, the by-code
// reads, the neighborhoods cache. The model and the cache are stand-ins (FakeQuery for the chains,
// TS-03); time is a FakeClock (TS-06). The real queries are covered by test/integration.
import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { AuctionsService } from './auctions.service.js';
import { activeAuctionFilter } from './utils/auction-filters.js';
import { PhaseModality } from './schemas/auction.schema.js';
import { serverOperators } from '../common/mongo/query-safety.js';
import { FakeClock } from '../../test/fakes/fake-clock.js';
import { FakeQuery } from '../../test/fakes/fake-query.js';

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
    // BR-004-16: the one active predicate, at the clock's now.
    expect(repo.countDocuments).toHaveBeenCalledWith(activeAuctionFilter(NOW));
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

  it('getAllCodes lists the active auctions, newest update first, as code and date only', async () => {
    const query = new FakeQuery([{ code: 'A1', updatedAt: NOW, title: 'not exposed' }]);
    const repo = { find: vi.fn().mockReturnValue(query) };

    await expect(build(repo).service.getAllCodes()).resolves.toEqual([
      { code: 'A1', updatedAt: NOW },
    ]);
    expect(repo.find).toHaveBeenCalledWith(activeAuctionFilter(NOW));
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
    expect(pipeline[0].$match).toMatchObject(activeAuctionFilter(NOW));
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
