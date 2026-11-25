// TS-07: the Caixa download never leaves the process. The list comes from FakeCaixaAccess, the
// hand-written fake of the CaixaAccess port (TS-03); the HTTP adapter has its own spec.
import { describe, expect, it, vi } from 'vitest';
import { CsvCacheService } from './csv-cache.service.js';
import { CaixaBlockedError, CaixaUnreachableError } from '../caixa/caixa-access.js';
import { FakeCaixaAccess } from '../../../test/fakes/fake-caixa-access.js';
import { FakeClock } from '../../../test/fakes/fake-clock.js';
import { spyOnLogger } from '../../../test/support/logger-spy.js';

type Deps = ConstructorParameters<typeof CsvCacheService>;

const NOW = new Date('2026-01-15T15:00:00.000Z'); // 12:00 on 15/01 in Brasília
const R2_KEY = 'importer/Lista_imoveis_geral.csv';

function build(opts: { configured?: boolean; lastUpload?: Date; r2?: Buffer | Error } = {}) {
  const caixa = new FakeCaixaAccess().serveList('fresh;csv');
  const record = opts.lastUpload ? { lastUpload: opts.lastUpload } : null;
  const model = {
    findOne: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(record) }),
    findOneAndUpdate: vi.fn().mockResolvedValue(undefined),
  };
  const storage = {
    isConfigured: vi.fn().mockReturnValue(opts.configured ?? true),
    downloadBuffer: vi.fn(() =>
      opts.r2 instanceof Error
        ? Promise.reject(opts.r2)
        : Promise.resolve(opts.r2 ?? Buffer.from('cached')),
    ),
    uploadBuffer: vi.fn().mockResolvedValue({ key: R2_KEY, size: 0 }),
  };
  const service = new CsvCacheService(
    model as unknown as Deps[0],
    storage as unknown as Deps[1],
    new FakeClock(NOW),
    caixa,
  );
  return { service, model, storage, caixa };
}

describe('CsvCacheService.resolveCsv without R2', () => {
  it('downloads straight from Caixa and caches nothing', async () => {
    const logger = spyOnLogger();
    const { service, model, storage, caixa } = build({ configured: false });

    await expect(service.resolveCsv()).resolves.toBe('fresh;csv');

    expect(caixa.requests).toEqual([{ kind: 'list' }]);
    expect(logger.loggedText()).toContain('R2 not configured');
    expect(model.findOne).not.toHaveBeenCalled();
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
  });
});

describe('CsvCacheService.resolveCsv with R2', () => {
  it('serves the copy cached today without calling Caixa', async () => {
    const { service, storage, caixa } = build({ lastUpload: new Date('2026-01-15T09:00:00.000Z') });

    await expect(service.resolveCsv()).resolves.toBe('cached');

    expect(storage.downloadBuffer).toHaveBeenCalledWith(R2_KEY);
    expect(caixa.requests).toEqual([]);
  });

  it('downloads from Caixa, caches the bytes and records the upload when there is no record', async () => {
    const { service, model, storage } = build();

    await expect(service.resolveCsv()).resolves.toBe('fresh;csv');

    expect(storage.uploadBuffer).toHaveBeenCalledWith(
      R2_KEY,
      Buffer.from('fresh;csv', 'utf8'),
      'text/csv; charset=utf-8',
    );
    expect(model.findOneAndUpdate).toHaveBeenCalledWith(
      {},
      { lastUpload: NOW, fileName: R2_KEY, fileSize: 9 }, // 'fresh;csv' is 9 bytes
      { upsert: true, returnDocument: 'after' },
    );
  });

  it('refreshes a copy cached on an earlier Brasília day', async () => {
    // 14/01 23:00 in Brasília is yesterday, although it is 02:00 UTC on 15/01.
    const { service, storage } = build({ lastUpload: new Date('2026-01-15T02:00:00.000Z') });

    await expect(service.resolveCsv()).resolves.toBe('fresh;csv');

    expect(storage.downloadBuffer).not.toHaveBeenCalled();
    expect(storage.uploadBuffer).toHaveBeenCalledTimes(1);
  });

  it('falls back to Caixa when today’s R2 copy cannot be read', async () => {
    const logger = spyOnLogger();
    const { service, storage } = build({
      lastUpload: new Date('2026-01-15T09:00:00.000Z'),
      r2: new Error('R2 down'),
    });

    await expect(service.resolveCsv()).resolves.toBe('fresh;csv');

    expect(logger.loggedText()).toContain('R2 fetch failed, falling back to Caixa: R2 down');
    expect(storage.uploadBuffer).toHaveBeenCalledTimes(1);
  });

  it('still returns the CSV when recording the upload fails', async () => {
    const logger = spyOnLogger();
    const { service, model } = build();
    model.findOneAndUpdate.mockRejectedValue(new Error('write failed'));

    await expect(service.resolveCsv()).resolves.toBe('fresh;csv');

    expect(logger.loggedText()).toContain('Failed to save CSV upload record: write failed');
  });

  it('fails when Caixa cannot be downloaded and there is nothing cached', async () => {
    const { service, storage, caixa } = build();
    caixa.serveList(new CaixaUnreachableError('NETWORK'));

    await expect(service.resolveCsv()).rejects.toBeInstanceOf(CaixaUnreachableError);
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
  });

  it('lets a block through to the run and caches nothing (BR-004-20)', async () => {
    const { service, storage, model, caixa } = build();
    caixa.serveList(new CaixaBlockedError('CHALLENGE_PAGE'));

    await expect(service.resolveCsv()).rejects.toBeInstanceOf(CaixaBlockedError);
    expect(storage.uploadBuffer).not.toHaveBeenCalled();
    expect(model.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
