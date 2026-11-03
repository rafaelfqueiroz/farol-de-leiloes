import { describe, expect, it, vi } from 'vitest';
import { serverOperators } from '../common/mongo/query-safety';
import { DomainError } from '../common/errors/domain-error';
import { AuctionsService } from './auctions.service';

type ServiceDeps = ConstructorParameters<typeof AuctionsService>;

describe('AuctionsService.markAvailable', () => {
  function build(modifiedCount = 0) {
    const repo = { updateMany: vi.fn().mockResolvedValue({ modifiedCount }) };
    const configService = { get: vi.fn().mockReturnValue(undefined) };
    const service = new AuctionsService(
      repo as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      configService as unknown as ServiceDeps[2],
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
      { $set: { available: true, updatedAt: expect.any(Date) } },
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

  it('builds the price range from finite numbers, including zero', async () => {
    const both = await builtQuery({ minMargin: 0, maxMargin: 500000 });
    expect(both['currentPhase.minimumPrice']).toEqual(serverOperators({ $gte: 0, $lte: 500000 }));

    const onlyMax = await builtQuery({ maxMargin: 10 });
    expect(onlyMax['currentPhase.minimumPrice']).toEqual(serverOperators({ $lte: 10 }));
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
    ['minMargin', { minMargin: '10' }],
    ['minMargin', { minMargin: Number.NaN }],
    ['maxMargin', { maxMargin: Number.POSITIVE_INFINITY }],
    ['maxMargin', { maxMargin: { $gt: 0 } }],
  ])(
    'refuses an operator or non-finite value for %s with VALIDATION_FAILED',
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
