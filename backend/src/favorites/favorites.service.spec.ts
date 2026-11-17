// FavoritesService over a stubbed FavoritesRepository (TS-01): what it asks the repository and the
// auctions service. The account scoping itself is the repository's, proven against MongoDB in
// test/integration/favorites.service.spec.ts and through the API in
// test/isolation/favorites.isolation.spec.ts (SPEC-002 BR-002-02).
import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import { FavoritesService } from './favorites.service.js';
import { DomainError } from '../common/errors/domain-error.js';
import { anAccessContext } from '../../test/fakes/fake-access-sources.js';

type ServiceDeps = ConstructorParameters<typeof FavoritesService>;

const ctx = await anAccessContext('64b7f0000000000000000001');
const AUCTION_ID = new Types.ObjectId('64b7f00000000000000000aa');

function build(parts: { found?: unknown; auctions?: Record<string, unknown> } = {}) {
  const favorites = {
    findByCode: vi.fn().mockResolvedValue(parts.found ?? null),
    create: vi.fn().mockResolvedValue({}),
    removeByCode: vi.fn().mockResolvedValue(true),
    findCodes: vi.fn().mockResolvedValue(['A1']),
  };
  const auctions = {
    findDocumentByCode: vi.fn().mockResolvedValue({ _id: AUCTION_ID }),
    findDocumentById: vi.fn().mockResolvedValue(null),
    findByCode: vi.fn().mockResolvedValue(null),
    toAuction: vi.fn((record: unknown) => ({ mapped: record })),
    ...parts.auctions,
  };
  const service = new FavoritesService(
    favorites as unknown as ServiceDeps[0],
    auctions as unknown as ServiceDeps[1],
  );
  return { service, favorites, auctions };
}

describe('FavoritesService.create', () => {
  it('reports an auction that is no longer available as not found instead of returning null (DV-03)', async () => {
    const { service, favorites } = build();

    await expect(service.create(ctx, 'A1')).rejects.toEqual(new DomainError('AUCTION_NOT_FOUND'));
    // BR-002-11: the account comes from the context; the payload never names it.
    expect(favorites.create).toHaveBeenCalledWith(ctx, { auctionCode: 'A1', auction: AUCTION_ID });
  });

  it('answers the favorited auction again, without a second favorite, when it already is one', async () => {
    const stored = { _id: AUCTION_ID, code: 'A1' };
    const { service, favorites, auctions } = build({
      found: { auctionCode: 'A1', auction: AUCTION_ID },
      auctions: { findDocumentById: vi.fn().mockResolvedValue(stored) },
    });

    await expect(service.create(ctx, 'A1')).resolves.toEqual({ mapped: stored });
    expect(auctions['findDocumentById']).toHaveBeenCalledWith(AUCTION_ID.toHexString());
    expect(favorites.create).not.toHaveBeenCalled();
  });

  it('refuses an auction code nobody imported', async () => {
    const { service, favorites } = build({
      auctions: { findDocumentByCode: vi.fn().mockResolvedValue(null) },
    });

    await expect(service.create(ctx, 'nope')).rejects.toEqual(new DomainError('AUCTION_NOT_FOUND'));
    expect(favorites.create).not.toHaveBeenCalled();
  });
});

// SC-10: a non-string code is "not a favorite" and never reaches the repository.
describe('FavoritesService.findOne and remove (SC-10)', () => {
  it('looks the code up in the account’s favorites', async () => {
    const favorite = { auctionCode: 'A1' };
    const { service, favorites } = build({ found: favorite });

    await expect(service.findOne(ctx, 'A1')).resolves.toBe(favorite);
    expect(favorites.findByCode).toHaveBeenCalledWith(ctx, 'A1');
  });

  it('finds and removes nothing, and never queries, for an object code', async () => {
    const { service, favorites } = build({ found: { auctionCode: 'A1' } });
    const operator = { $ne: null } as unknown as string;

    await expect(service.findOne(ctx, operator)).resolves.toBeNull();
    await expect(service.remove(ctx, operator)).resolves.toBe(false);
    expect(favorites.findByCode).not.toHaveBeenCalled();
    expect(favorites.removeByCode).not.toHaveBeenCalled();
  });

  it('removes the account’s favorite of a code', async () => {
    const { service, favorites } = build();

    await expect(service.remove(ctx, 'A1')).resolves.toBe(true);
    expect(favorites.removeByCode).toHaveBeenCalledWith(ctx, 'A1');
  });
});
