import { AuctionsService } from '../src/auctions/auctions.service';

describe('AuctionsService.markAvailable', () => {
  function build(modifiedCount = 0) {
    const repo = { updateMany: jest.fn().mockResolvedValue({ modifiedCount }) };
    const configService = { get: jest.fn().mockReturnValue(undefined) };
    const service = new AuctionsService(repo as any, {} as any, configService as any);
    return { service, repo };
  }

  it('marks unavailable auctions in the CSV as available and returns the modified count', async () => {
    const { service, repo } = build(3);

    await expect(service.markAvailable(['A1', 'A2'])).resolves.toBe(3);
    expect(repo.updateMany).toHaveBeenCalledWith(
      { code: { $in: ['A1', 'A2'] }, available: { $ne: true } },
      { $set: { available: true, updatedAt: expect.any(Date) } },
    );
  });

  it('does nothing for an empty code list', async () => {
    const { service, repo } = build();

    await expect(service.markAvailable([])).resolves.toBe(0);
    expect(repo.updateMany).not.toHaveBeenCalled();
  });
});
