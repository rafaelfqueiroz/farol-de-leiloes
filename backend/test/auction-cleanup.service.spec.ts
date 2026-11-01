import { AuctionCleanupService } from '../src/auctions/cleanup/auction-cleanup.service';

describe('AuctionCleanupService.processAuction', () => {
  const auction = {
    _id: 'id-1',
    code: 'A1',
    image: { storageKey: 'img' },
    matricula: { storageKey: 'mat' },
  } as any;

  function build(deleteFile: jest.Mock, configured = true) {
    const auctionModel = { deleteOne: jest.fn().mockResolvedValue({}) };
    const storage = { isConfigured: jest.fn().mockReturnValue(configured), deleteFile };
    const service = new AuctionCleanupService(auctionModel as any, storage as any, {} as any);
    return { service: service as any, auctionModel };
  }

  it('deletes the auction when every file deletion succeeds', async () => {
    const { service, auctionModel } = build(jest.fn().mockResolvedValue(true));

    await expect(service.processAuction(auction)).resolves.toEqual({
      removed: true,
      filesDeleted: 2,
    });
    expect(auctionModel.deleteOne).toHaveBeenCalledWith({ _id: 'id-1' });
  });

  it('keeps the auction when any file deletion fails', async () => {
    const { service, auctionModel } = build(
      jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false),
    );

    await expect(service.processAuction(auction)).resolves.toEqual({
      removed: false,
      filesDeleted: 1,
    });
    expect(auctionModel.deleteOne).not.toHaveBeenCalled();
  });

  it('keeps the auction when it has files but storage is not configured', async () => {
    const deleteFile = jest.fn();
    const { service, auctionModel } = build(deleteFile, false);

    await expect(service.processAuction(auction)).resolves.toEqual({
      removed: false,
      filesDeleted: 0,
    });
    expect(deleteFile).not.toHaveBeenCalled();
    expect(auctionModel.deleteOne).not.toHaveBeenCalled();
  });

  it('deletes an auction without files', async () => {
    const { service, auctionModel } = build(jest.fn());

    await expect(service.processAuction({ _id: 'id-2', code: 'A2' } as any)).resolves.toEqual({
      removed: true,
      filesDeleted: 0,
    });
    expect(auctionModel.deleteOne).toHaveBeenCalled();
  });
});
