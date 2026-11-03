import { describe, expect, it, type Mock, vi } from 'vitest';
import { AuctionCleanupService } from './auction-cleanup.service';
import { FakeClock } from '../../../test/fakes/fake-clock';

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
