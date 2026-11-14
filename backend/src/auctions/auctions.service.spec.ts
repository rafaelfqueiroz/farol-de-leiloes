import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { serverOperators } from '../common/mongo/query-safety.js';
import { DomainError } from '../common/errors/domain-error.js';
import { Decimal } from '../common/money/money.js';
import { AuctionsService } from './auctions.service.js';
import { PhaseModality } from './schemas/auction.schema.js';
import { FakeClock } from '../../test/fakes/fake-clock.js';

type ServiceDeps = ConstructorParameters<typeof AuctionsService>;

// TS-06: the service's "now" is a fixed instant from the injected clock.
const NOW = new Date('2026-01-15T12:00:00.000Z');
const d128 = (value: string) => Types.Decimal128.fromString(value);

describe('AuctionsService.markAvailable', () => {
  function build(modifiedCount = 0) {
    const repo = { updateMany: vi.fn().mockResolvedValue({ modifiedCount }) };
    const configService = { get: vi.fn().mockReturnValue(undefined) };
    const service = new AuctionsService(
      repo as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      configService as unknown as ServiceDeps[2],
      new FakeClock(NOW),
    );
    return { service, repo };
  }

  it('marks unavailable auctions in the CSV as available and returns the modified count', async () => {
    const { service, repo } = build(3);

    await expect(service.markAvailable(['A1', 'A2'])).resolves.toBe(3);
    expect(repo.updateMany).toHaveBeenCalledWith(
      {
        code: serverOperators({ $in: ['A1', 'A2'] }),
        available: serverOperators({ $ne: true }),
      },
      { $set: { available: true, updatedAt: NOW } },
    );
  });

  it('does nothing for an empty code list', async () => {
    const { service, repo } = build();

    await expect(service.markAvailable([])).resolves.toBe(0);
    expect(repo.updateMany).not.toHaveBeenCalled();
  });
});

// SC-10, TS-13 (the real-database half lives in test/integration): the list query is built from
// text and finite numbers only, and anything else is refused with VALIDATION_FAILED (AR-34, AR-37).
describe('AuctionsService.query (SC-10)', () => {
  function build() {
    const find = vi.fn();
    const chain = {
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([]),
    };
    find.mockReturnValue(chain);
    const repo = {
      find,
      countDocuments: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(0) }),
    };
    const service = new AuctionsService(
      repo as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      { get: vi.fn().mockReturnValue(undefined) } as unknown as ServiceDeps[2],
      new FakeClock(NOW),
    );
    return { service, repo };
  }

  const page = { page: 1, pageSize: 10 };

  async function builtQuery(filters: Parameters<AuctionsService['query']>[0]) {
    const { service, repo } = build();
    await service.query(filters, page);
    return repo.find.mock.calls[0]?.[0] as Record<string, unknown>;
  }

  it('compares the state by equality, upper-cased', async () => {
    const query = await builtQuery({ state: 'sp' });
    expect(query['address.state']).toEqual({ $eq: 'SP' });
  });

  it('matches a single city or neighborhood as a literal, case-insensitive prefix', async () => {
    const query = await builtQuery({ city: 'São.Paulo', neighborhood: 'Centro' });
    expect(query['address.city']).toEqual(/^São\.Paulo/i);
    expect(query['address.neighborhood']).toEqual(/^Centro/i);
  });

  it('matches several cities as a server-built $in of prefixes', async () => {
    const query = await builtQuery({ city: ['Santos', 'Campinas'] });
    expect(query['address.city']).toEqual(serverOperators({ $in: [/^Santos/i, /^Campinas/i] }));
  });

  it('matches one modality by equality and several with a server-built $in', async () => {
    const single = await builtQuery({ modality: 'ONLINE_SALES' });
    expect(single['currentPhase.modality']).toEqual({ $eq: 'ONLINE_SALES' });

    const several = await builtQuery({ modality: ['ONLINE_SALES', 'AUCTION'] });
    expect(several['currentPhase.modality']).toEqual(
      serverOperators({ $in: ['ONLINE_SALES', 'AUCTION'] }),
    );
  });

  it('AR-17: builds the price range as Decimal128 bounds, including zero', async () => {
    const both = await builtQuery({
      minPrice: new Decimal('0'),
      maxPrice: new Decimal('500000'),
    });
    expect(both['currentPhase.minimumPrice']).toEqual(
      serverOperators({ $gte: d128('0'), $lte: d128('500000') }),
    );

    const onlyMax = await builtQuery({ maxPrice: new Decimal('10.50') });
    expect(onlyMax['currentPhase.minimumPrice']).toEqual(serverOperators({ $lte: d128('10.5') }));
  });

  it('adds no filter for what the request did not send', async () => {
    const query = await builtQuery({});
    expect(query).not.toHaveProperty('address.state');
    expect(query).not.toHaveProperty('currentPhase.minimumPrice');
  });

  it.each([
    ['state', { state: { $ne: null } }],
    ['city', { city: { $regex: '.*' } }],
    ['city', { city: ['Santos', { $gt: '' }] }],
    ['neighborhood', { neighborhood: { $ne: null } }],
    ['modality', { modality: { $ne: null } }],
    ['modality', { modality: ['AUCTION', 7] }],
    ['minPrice', { minPrice: '10' }],
    ['minPrice', { minPrice: 10 }],
    ['minPrice', { minPrice: new Decimal(Number.NaN) }],
    ['maxPrice', { maxPrice: new Decimal(Number.POSITIVE_INFINITY) }],
    ['maxPrice', { maxPrice: { $gt: 0 } }],
  ])(
    'refuses an operator, a non-Decimal or a non-finite value for %s with VALIDATION_FAILED',
    async (field, bad) => {
      const { service, repo } = build();

      await expect(
        service.query(bad as unknown as Parameters<AuctionsService['query']>[0], page),
      ).rejects.toEqual(new DomainError('VALIDATION_FAILED', { fields: [field] }));
      expect(repo.find).not.toHaveBeenCalled();
    },
  );
});

describe('AuctionsService code lookups (SC-10)', () => {
  function build(found: unknown = null) {
    const exec = vi.fn().mockResolvedValue(found);
    const repo = { findOne: vi.fn().mockReturnValue({ exec }) };
    const service = new AuctionsService(
      repo as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      { get: vi.fn().mockReturnValue(undefined) } as unknown as ServiceDeps[2],
      new FakeClock(NOW),
    );
    return { service, repo };
  }

  const operator = { $ne: null } as unknown as string;

  it('findByCode compares the code by equality and only among available auctions', async () => {
    const { service, repo } = build();

    await expect(service.findByCode('A1')).resolves.toBeNull();
    expect(repo.findOne).toHaveBeenCalledWith({ code: { $eq: 'A1' }, available: true });
  });

  it('findByCode finds nothing, and never queries, for a non-string code', async () => {
    const { service, repo } = build();

    await expect(service.findByCode(operator)).resolves.toBeNull();
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it('findDocumentByCode compares the code by equality', async () => {
    const doc = { code: 'A1' };
    const { service, repo } = build(doc);

    await expect(service.findDocumentByCode('A1')).resolves.toBe(doc);
    expect(repo.findOne).toHaveBeenCalledWith({ code: { $eq: 'A1' } });
  });

  it('findDocumentByCode finds nothing, and never queries, for a non-string code', async () => {
    const { service, repo } = build({ code: 'A1' });

    await expect(service.findDocumentByCode(operator)).resolves.toBeNull();
    expect(repo.findOne).not.toHaveBeenCalled();
  });
});

describe('AuctionsService document id lookups (AR-09, SC-10)', () => {
  function build() {
    const exec = vi.fn().mockResolvedValue(null);
    const repo = { findOne: vi.fn().mockReturnValue({ exec }) };
    const service = new AuctionsService(
      repo as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      { get: vi.fn().mockReturnValue(undefined) } as unknown as ServiceDeps[2],
      new FakeClock(NOW),
    );
    return { service, repo, exec };
  }

  it('compares the document id by equality, including unavailable auctions', async () => {
    const { service, repo, exec } = build();
    const doc = { code: 'A1', available: false };
    exec.mockResolvedValue(doc);

    await expect(service.findDocumentById('64b000000000000000000001')).resolves.toBe(doc);
    expect(repo.findOne).toHaveBeenCalledWith({ _id: { $eq: '64b000000000000000000001' } });
  });

  it('finds nothing and never queries for an operator object', async () => {
    const { service, repo } = build();

    await expect(service.findDocumentById({ $ne: null } as unknown as string)).resolves.toBeNull();
    expect(repo.findOne).not.toHaveBeenCalled();
  });

  it.each(['not-an-id', '', 'abcdefghijkl', '64b00000000000000000000g'])(
    'finds nothing and never queries for malformed id %j',
    async (id) => {
      const { service, repo } = build();

      await expect(service.findDocumentById(id)).resolves.toBeNull();
      expect(repo.findOne).not.toHaveBeenCalled();
    },
  );

  it('propagates database failures for a valid id', async () => {
    const { service, exec } = build();
    const databaseError = new Error('database unavailable');
    exec.mockRejectedValue(databaseError);

    await expect(service.findDocumentById('64b000000000000000000001')).rejects.toBe(databaseError);
  });
});

// AR-17: every writer writes Decimal128; stored phases, Decimal128 since the #34 migration, are
// written back as read. AR-24: the timestamps come from the injected clock.
describe('AuctionsService.upsertMany', () => {
  function build(existing: unknown[]) {
    const repo = {
      find: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(existing) }),
      }),
      bulkWrite: vi.fn().mockResolvedValue({ matchedCount: 0, upsertedCount: 0, modifiedCount: 1 }),
    };
    const service = new AuctionsService(
      repo as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      { get: vi.fn().mockReturnValue(undefined) } as unknown as ServiceDeps[2],
      new FakeClock(NOW),
    );
    return { service, repo };
  }

  const onlineSale = {
    modality: PhaseModality.ONLINE_SALES,
    minimumPrice: new Decimal('91589.89'),
  };

  it('inserts a new auction with its prices as Decimal128', async () => {
    const { service, repo } = build([]);

    await service.upsertMany([
      { code: 'A1', appraisalPrice: new Decimal('250000.00'), phases: [onlineSale] },
    ]);

    const [ops] = repo.bulkWrite.mock.calls[0] as [{ insertOne: { document: unknown } }[]];
    const stored = { modality: PhaseModality.ONLINE_SALES, minimumPrice: d128('91589.89') };
    expect(ops[0]?.insertOne.document).toEqual({
      code: 'A1',
      title: null,
      address: {},
      appraisalPrice: d128('250000'), // decimal.js writes no trailing zeros; same value
      phases: [stored],
      currentPhase: stored,
      detailsUrl: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it('appends a new phase, writing the stored one back as it was read', async () => {
    const stored = {
      modality: PhaseModality.SFI_AUCTION,
      minimumPrice: d128('120000.5'),
      phaseDates: [],
    };
    const { service, repo } = build([{ code: 'A1', phases: [stored] }]);

    await service.upsertMany([{ code: 'A1', phases: [onlineSale] }]);

    const [ops] = repo.bulkWrite.mock.calls[0] as [
      { updateOne: { update: { $set: Record<string, unknown> } } }[],
    ];
    expect(ops[0]?.updateOne.update.$set).toEqual({
      phases: [
        { modality: PhaseModality.SFI_AUCTION, minimumPrice: d128('120000.5'), phaseDates: [] },
        { modality: PhaseModality.ONLINE_SALES, minimumPrice: d128('91589.89') },
      ],
      currentPhase: { modality: PhaseModality.ONLINE_SALES, minimumPrice: d128('91589.89') },
      updatedAt: NOW,
    });
  });

  it('writes a missing price as null, never as a number', async () => {
    const { service, repo } = build([]);

    await service.upsertMany([
      { code: 'A1', phases: [{ modality: PhaseModality.ONLINE_SALES, minimumPrice: null }] },
    ]);

    const [ops] = repo.bulkWrite.mock.calls[0] as [
      { insertOne: { document: Record<string, unknown> } }[],
    ];
    expect(ops[0]?.insertOne.document.appraisalPrice).toBeNull();
    expect(ops[0]?.insertOne.document.currentPhase).toEqual({
      modality: PhaseModality.ONLINE_SALES,
      minimumPrice: null,
    });
  });
});

// AR-24 / TS-06: whether an auction is still open is decided against the injected clock.
describe('AuctionsService.findActiveCodes', () => {
  function build(docs: unknown[], now: Date) {
    const repo = {
      find: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          lean: vi.fn().mockReturnValue({ exec: vi.fn().mockResolvedValue(docs) }),
        }),
      }),
    };
    return new AuctionsService(
      repo as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      { get: vi.fn().mockReturnValue(undefined) } as unknown as ServiceDeps[2],
      new FakeClock(now),
    );
  }

  const auctionOn = (code: string, date: string) => {
    const phase = { modality: PhaseModality.SFI_AUCTION, phaseDates: [new Date(date)] };
    return { code, available: true, phases: [phase], currentPhase: phase, updatedAt: NOW };
  };

  it('keeps an auction whose date is at or after now and drops one already past', async () => {
    const docs = [
      auctionOn('PAST', '2026-01-15T11:59:59.999Z'),
      auctionOn('NOW', '2026-01-15T12:00:00.000Z'),
      auctionOn('LATER', '2026-01-16T00:00:00.000Z'),
    ];

    await expect(build(docs, NOW).findActiveCodes(['PAST', 'NOW', 'LATER'])).resolves.toEqual(
      new Set(['NOW', 'LATER']),
    );
    // A day later by the clock, every one of them has closed.
    await expect(
      build(docs, new Date('2026-01-16T00:00:00.001Z')).findActiveCodes(['PAST', 'NOW', 'LATER']),
    ).resolves.toEqual(new Set());
  });
});
