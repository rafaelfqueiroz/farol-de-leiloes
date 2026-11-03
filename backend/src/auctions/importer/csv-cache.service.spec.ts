// AR-23 / AR-24 / TS-11: the cached Caixa list is "today's" by the Brasília calendar and the
// injected clock — not the UTC date, which rolls over at 21:00 in Brasília.
import { describe, expect, it, vi } from 'vitest';
import { CsvCacheService } from './csv-cache.service';
import { FakeClock } from '../../../test/fakes/fake-clock';

type ServiceDeps = ConstructorParameters<typeof CsvCacheService>;

function build(now: string, lastUpload?: string) {
  const record = lastUpload ? { lastUpload: new Date(lastUpload) } : null;
  const model = { findOne: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(record) }) };
  const storage = {
    isConfigured: vi.fn().mockReturnValue(true),
    downloadBuffer: vi.fn().mockResolvedValue(Buffer.from('cached;csv')),
  };
  const service = new CsvCacheService(
    model as unknown as ServiceDeps[0],
    storage as unknown as ServiceDeps[1],
    new FakeClock(new Date(now)),
  );
  // isTodaysUpload is private; bracket access keeps its signature type-checked.
  const isTodaysUpload = (at: string) => service['isTodaysUpload'](new Date(at));
  return { service, storage, isTodaysUpload };
}

describe('CsvCacheService', () => {
  it('serves the R2 copy uploaded earlier the same Brasília day', async () => {
    // Uploaded 22:00 on 15/01 in Brasília (01:00 UTC on 16/01); now 23:30 on 15/01 in Brasília.
    const { service, storage } = build('2026-01-16T02:30:00.000Z', '2026-01-16T01:00:00.000Z');

    await expect(service.resolveCsv()).resolves.toBe('cached;csv');
    expect(storage.downloadBuffer).toHaveBeenCalledWith('importer/Lista_imoveis_geral.csv');
  });

  it('counts an upload at 22:00 in Brasília as that day, though it is the next day in UTC', () => {
    const { isTodaysUpload } = build('2026-01-15T13:00:00.000Z');

    expect(isTodaysUpload('2026-01-16T01:00:00.000Z')).toBe(true); // 15/01 22:00 Brasília
    expect(isTodaysUpload('2026-01-15T03:00:00.000Z')).toBe(true); // 15/01 00:00 Brasília
    expect(isTodaysUpload('2026-01-15T02:59:59.999Z')).toBe(false); // 14/01 23:59 Brasília
    expect(isTodaysUpload('2026-01-16T03:00:00.000Z')).toBe(false); // 16/01 00:00 Brasília
  });
});
