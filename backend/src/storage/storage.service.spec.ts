// SC-24: the copies of Caixa images and matrículas to R2 identify the product, never a browser.
//
// TS-07: nothing reaches Caixa or R2. `fetch` has no port yet, so it is replaced with a stub
// (TS-03: a stub of a platform global, not of a module we own), and the S3 client's `send` is
// stubbed so no upload leaves the process.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { CAIXA_USER_AGENT } from '../common/caixa-user-agent';
import { StorageService } from './storage.service';

// Fake credentials: the S3 client is built but never sends (`send` is stubbed below).
const config = {
  accountId: 'test-account',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  bucket: 'test-bucket',
  publicUrl: 'https://cdn.test',
};

// Never requested: `fetch` is stubbed. Shaped like a Caixa asset URL for realism only.
const IMAGE_URL = 'https://venda-imoveis.caixa.gov.br/fotos/F0000000000000.jpg';
const MATRICULA_URL = 'https://venda-imoveis.caixa.gov.br/editais/matricula/0000000000000.pdf';

const fetchStub = vi.fn();

beforeEach(() => {
  fetchStub.mockResolvedValue(new Response(new Uint8Array([1, 2, 3])));
  vi.stubGlobal('fetch', fetchStub);
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async () => ({}));
});

afterEach(() => {
  fetchStub.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function sentUserAgent(): string | undefined {
  const [, init] = fetchStub.mock.calls[0] as [string, RequestInit];
  return (init.headers as Record<string, string>)['User-Agent'];
}

describe('StorageService User-Agent (SC-24)', () => {
  it('names the product, not a browser, in the image copy', async () => {
    const service = new StorageService(config);

    const result = await service.uploadImageFromUrl(IMAGE_URL, 'A1');

    expect(result).not.toBeNull();
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(fetchStub).toHaveBeenCalledWith(IMAGE_URL, expect.anything());
    expect(sentUserAgent()).toBe(CAIXA_USER_AGENT);
    expect(sentUserAgent() ?? '').not.toMatch(/Mozilla|AppleWebKit|Chrome/);
  });

  it('names the product, not a browser, in the matrícula copy', async () => {
    const service = new StorageService(config);

    const result = await service.uploadDocumentFromUrl(MATRICULA_URL, 'A1', 'matricula');

    expect(result).not.toBeNull();
    expect(fetchStub).toHaveBeenCalledOnce();
    expect(fetchStub).toHaveBeenCalledWith(MATRICULA_URL, expect.anything());
    expect(sentUserAgent()).toBe(CAIXA_USER_AGENT);
    expect(sentUserAgent() ?? '').not.toMatch(/Mozilla|AppleWebKit|Chrome/);
  });
});
