import { subDays } from 'date-fns';
import { describe, expect, it, type Mock, vi } from 'vitest';
import { AuctionCleanupService } from './auction-cleanup.service';
import { FakeClock } from '../../../test/fakes/fake-clock';
import { testBusinessConfig } from '../../../test/support/test-env';

type ServiceDeps = ConstructorParameters<typeof AuctionCleanupService>;
type CleanupTarget = Parameters<AuctionCleanupService['processAuction']>[0];

describe('AuctionCleanupService.processAuction', () => {
  const auction = {
    _id: 'id-1',
    code: 'A1',
    image: { storageKey: 'img' },
    matricula: { storageKey: 'mat' },
  } as unknown as CleanupTarget;

  function build(deleteFile: Mock, configured = true) {
    const auctionModel = { deleteOne: vi.fn().mockResolvedValue({}) };
    const storage = { isConfigured: vi.fn().mockReturnValue(configured), deleteFile };
    const cleanup = new AuctionCleanupService(
      auctionModel as unknown as ServiceDeps[0],
      storage as unknown as ServiceDeps[1],
      {} as ServiceDeps[2],
      testBusinessConfig(),
      new FakeClock(),
    );
    // processAuction is private; bracket access keeps its signature type-checked.
    const service = { processAuction: (a: CleanupTarget) => cleanup['processAuction'](a) };
    return { service, auctionModel };
  }

  it('deletes the auction when every file deletion succeeds', async () => {
    const { service, auctionModel } = build(vi.fn().mockResolvedValue(true));

    await expect(service.processAuction(auction)).resolves.toEqual({
      removed: true,
      filesDeleted: 2,
    });
    expect(auctionModel.deleteOne).toHaveBeenCalledWith({ _id: 'id-1' });
  });

  it('keeps the auction when any file deletion fails', async () => {
    const { service, auctionModel } = build(
      vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    );

    await expect(service.processAuction(auction)).resolves.toEqual({
      removed: false,
      filesDeleted: 1,
    });
    expect(auctionModel.deleteOne).not.toHaveBeenCalled();
  });

  it('keeps the auction when it has files but storage is not configured', async () => {
    const deleteFile = vi.fn();
    const { service, auctionModel } = build(deleteFile, false);

    await expect(service.processAuction(auction)).resolves.toEqual({
      removed: false,
      filesDeleted: 0,
    });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(auctionModel.deleteOne).not.toHaveBeenCalled();
  });

  it('deletes an auction without files', async () => {
    const { service, auctionModel } = build(vi.fn());

    await expect(
      service.processAuction({ _id: 'id-2', code: 'A2' } as unknown as CleanupTarget),
    ).resolves.toEqual({
      removed: true,
      filesDeleted: 0,
    });
    expect(auctionModel.deleteOne).toHaveBeenCalled();
  });
});

describe('AuctionCleanupService retention period (AR-43)', () => {
  type Query = { updatedAt: { $lte: Date } };

  /** Runs one cleanup pass with the given setting and returns the query it sent to the model. */
  async function queryFor(overrides: Record<string, string | undefined>): Promise<Query> {
    const clock = new FakeClock();
    const find = vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) });
    const cleanup = new AuctionCleanupService(
      { find } as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      {} as ServiceDeps[2],
      testBusinessConfig(overrides),
      clock,
    );
    await cleanup['runCleanup']();
    expect(find).toHaveBeenCalledOnce();
    return find.mock.calls[0]?.[0] as Query;
  }

  it('selects auctions unavailable for longer than the default 14 days', async () => {
    const query = await queryFor({});
    expect(query.updatedAt.$lte).toEqual(subDays(new FakeClock().now(), 14));
  });

  it('follows UNAVAILABLE_AUCTION_RETENTION_DAYS with no code change', async () => {
    const query = await queryFor({ UNAVAILABLE_AUCTION_RETENTION_DAYS: '30' });
    expect(query.updatedAt.$lte).toEqual(subDays(new FakeClock().now(), 30));
  });
});
