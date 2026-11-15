// TS-07: nothing reaches Caixa or R2. `fetch` is stubbed (a platform global, TS-03) and the S3
// client's `send` is stubbed, so each upload, download and delete is observed as the command the
// service built. Signing a URL is a local computation with the fake credentials.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { StorageService } from './storage.service.js';

const config = {
  accountId: 'test-account',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  bucket: 'test-bucket',
  publicUrl: 'https://cdn.test',
};
const SOURCE = 'https://venda-imoveis.caixa.gov.br/fotos/F0000000000000.jpg';

const fetchStub = vi.fn();
let send: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async () => ({}));
});

afterEach(() => {
  fetchStub.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The input of the n-th command sent to the (stubbed) bucket. */
function sentInput(n = 0): Record<string, unknown> {
  const command = send.mock.calls[n]?.[0] as { input: Record<string, unknown> };
  return command.input;
}

const notConfigured = { ...config, secretAccessKey: '' };

describe('StorageService without R2 credentials', () => {
  it('reports itself unconfigured and does nothing instead of failing', async () => {
    const service = new StorageService(notConfigured);

    expect(service.isConfigured()).toBe(false);
    await expect(service.uploadImageFromUrl(SOURCE, 'A1')).resolves.toBeNull();
    await expect(service.uploadDocumentFromUrl(SOURCE, 'A1', 'edital')).resolves.toBeNull();
    await expect(service.getSignedUrl('k')).resolves.toBeNull();
    await expect(service.deleteFile('k')).resolves.toBe(false);
    expect(fetchStub).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses to upload or download a buffer', async () => {
    const service = new StorageService(notConfigured);

    await expect(service.uploadBuffer('k', Buffer.from('x'), 'text/plain')).rejects.toThrow(
      'R2 not configured',
    );
    await expect(service.downloadBuffer('k')).rejects.toThrow('R2 not configured');
  });
});

describe('StorageService.uploadImageFromUrl', () => {
  it('stores the image under images/<code> with the extension of its content type', async () => {
    fetchStub.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    );

    const result = await new StorageService(config).uploadImageFromUrl(SOURCE, 'A1');

    expect(result).toEqual({
      key: 'images/A1.png',
      url: 'https://cdn.test/images/A1.png',
      size: 3,
    });
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(PutObjectCommand);
    expect(sentInput()).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'images/A1.png',
      ContentType: 'image/png',
    });
  });

  it.each([
    ['image/jpeg', '.jpg'],
    ['image/jpg', '.jpg'],
    ['image/gif', '.gif'],
    ['image/webp', '.webp'],
    ['image/tiff', '.jpg'], // unknown types fall back to .jpg
  ])('maps %s to %s', async (contentType, ext) => {
    fetchStub.mockResolvedValue(
      new Response(new Uint8Array([1]), { headers: { 'content-type': contentType } }),
    );

    const result = await new StorageService(config).uploadImageFromUrl(SOURCE, 'A1');

    expect(result?.key).toBe(`images/A1${ext}`);
  });

  it('assumes image/jpeg when the response names no content type', async () => {
    // A Blob-less body: Response sets no content-type for a Uint8Array.
    fetchStub.mockResolvedValue(new Response(new Uint8Array([1, 2])));

    const result = await new StorageService(config).uploadImageFromUrl(SOURCE, 'A1');

    expect(result).toMatchObject({ key: 'images/A1.jpg', size: 2 });
    expect(sentInput()['ContentType']).toBe('image/jpeg');
  });

  it('answers the bare key when no public URL is configured', async () => {
    fetchStub.mockResolvedValue(new Response(new Uint8Array([1])));

    const result = await new StorageService({ ...config, publicUrl: '' }).uploadImageFromUrl(
      SOURCE,
      'A1',
    );

    expect(result?.url).toBe('images/A1.jpg');
  });

  it('returns null without uploading when the source answers an error status', async () => {
    fetchStub.mockResolvedValue(new Response('gone', { status: 404 }));

    await expect(new StorageService(config).uploadImageFromUrl(SOURCE, 'A1')).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('returns null when the download or the upload throws', async () => {
    fetchStub.mockRejectedValueOnce(new Error('network down'));
    const service = new StorageService(config);
    await expect(service.uploadImageFromUrl(SOURCE, 'A1')).resolves.toBeNull();

    fetchStub.mockResolvedValue(new Response(new Uint8Array([1])));
    send.mockRejectedValueOnce(new Error('bucket unavailable'));
    await expect(service.uploadImageFromUrl(SOURCE, 'A1')).resolves.toBeNull();
  });
});

describe('StorageService.uploadDocumentFromUrl', () => {
  it('stores the document under documents/<code>/<type>.pdf', async () => {
    fetchStub.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3, 4]), {
        headers: { 'content-type': 'application/pdf' },
      }),
    );

    const result = await new StorageService(config).uploadDocumentFromUrl(SOURCE, 'A1', 'edital');

    expect(result).toEqual({
      key: 'documents/A1/edital.pdf',
      url: 'https://cdn.test/documents/A1/edital.pdf',
      size: 4,
    });
    expect(sentInput()).toMatchObject({
      Key: 'documents/A1/edital.pdf',
      ContentType: 'application/pdf',
    });
  });

  it('assumes application/pdf and a bare key when the response and config say nothing', async () => {
    fetchStub.mockResolvedValue(new Response(new Uint8Array([1])));

    const result = await new StorageService({ ...config, publicUrl: '' }).uploadDocumentFromUrl(
      SOURCE,
      'A1',
      'matricula',
    );

    expect(result?.url).toBe('documents/A1/matricula.pdf');
    expect(sentInput()['ContentType']).toBe('application/pdf');
  });

  it('returns null without uploading when the source answers an error status', async () => {
    fetchStub.mockResolvedValue(new Response('no', { status: 503 }));

    await expect(
      new StorageService(config).uploadDocumentFromUrl(SOURCE, 'A1', 'edital'),
    ).resolves.toBeNull();
    expect(send).not.toHaveBeenCalled();
  });

  it('returns null when the upload throws', async () => {
    fetchStub.mockResolvedValue(new Response(new Uint8Array([1])));
    send.mockRejectedValueOnce(new Error('bucket unavailable'));

    await expect(
      new StorageService(config).uploadDocumentFromUrl(SOURCE, 'A1', 'edital'),
    ).resolves.toBeNull();
  });
});

describe('StorageService.getSignedUrl', () => {
  it('signs a download link for the key that expires after an hour by default', async () => {
    const url = await new StorageService(config).getSignedUrl('documents/A1/edital.pdf');

    const parsed = new URL(url ?? '');
    expect(parsed.hostname).toBe('test-bucket.test-account.r2.cloudflarestorage.com');
    expect(parsed.pathname).toBe('/documents/A1/edital.pdf');
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('3600');
    expect(parsed.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('honours a custom expiry', async () => {
    const url = await new StorageService(config).getSignedUrl('k', 60);
    expect(new URL(url ?? '').searchParams.get('X-Amz-Expires')).toBe('60');
  });

  it('returns null instead of throwing when the expiry cannot be signed', async () => {
    // S3 presigned URLs are capped at 7 days; the signer throws beyond that.
    await expect(new StorageService(config).getSignedUrl('k', 8 * 24 * 3600)).resolves.toBeNull();
  });
});

describe('StorageService.deleteFile', () => {
  it('deletes the object and answers true', async () => {
    await expect(new StorageService(config).deleteFile('images/A1.jpg')).resolves.toBe(true);

    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(DeleteObjectCommand);
    expect(sentInput()).toEqual({ Bucket: 'test-bucket', Key: 'images/A1.jpg' });
  });

  it('answers false when the bucket refuses', async () => {
    send.mockRejectedValueOnce(new Error('denied'));
    await expect(new StorageService(config).deleteFile('images/A1.jpg')).resolves.toBe(false);
  });
});

describe('StorageService buffers', () => {
  it('uploadBuffer puts the bytes under the key and reports their size', async () => {
    const result = await new StorageService(config).uploadBuffer(
      'exports/a.csv',
      Buffer.from('abcde'),
      'text/csv',
    );

    expect(result).toEqual({ key: 'exports/a.csv', size: 5 });
    expect(sentInput()).toMatchObject({
      Bucket: 'test-bucket',
      Key: 'exports/a.csv',
      ContentType: 'text/csv',
    });
  });

  it('downloadBuffer returns the bytes of the object', async () => {
    send.mockResolvedValueOnce({
      Body: { transformToByteArray: async () => new Uint8Array([7, 8, 9]) },
    });

    const buffer = await new StorageService(config).downloadBuffer('exports/a.csv');

    expect(buffer).toEqual(Buffer.from([7, 8, 9]));
    expect(send.mock.calls[0]?.[0]).toBeInstanceOf(GetObjectCommand);
    expect(sentInput()).toEqual({ Bucket: 'test-bucket', Key: 'exports/a.csv' });
  });

  it('downloadBuffer fails clearly for an object with no body', async () => {
    send.mockResolvedValueOnce({});
    await expect(new StorageService(config).downloadBuffer('exports/a.csv')).rejects.toThrow(
      'R2 object exports/a.csv has no body',
    );
  });
});
