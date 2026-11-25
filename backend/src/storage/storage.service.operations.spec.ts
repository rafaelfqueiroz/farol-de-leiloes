// TS-07: nothing reaches R2. The S3 client's `send` is stubbed, so each upload, download and delete is observed as the command the
// service built. Signing a URL is a local computation with the fake credentials.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service.js';

const config = {
  accountId: 'test-account',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  bucket: 'test-bucket',
  publicUrl: 'https://cdn.test',
};

let send: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async () => ({}));
});

afterEach(() => {
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
    await expect(service.getSignedUrl('k')).resolves.toBeNull();
    await expect(service.deleteFile('k')).resolves.toBe(false);
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

describe('StorageService.publicUrlFor (SPEC-004 BR-004-22)', () => {
  it('joins the public base URL and the key of a catalogue file', () => {
    expect(new StorageService(config).publicUrlFor('auctions/1/photos/a.jpg')).toBe(
      'https://cdn.test/auctions/1/photos/a.jpg',
    );
  });

  it('answers the key itself when no public base URL is configured', () => {
    expect(new StorageService({ ...config, publicUrl: '' }).publicUrlFor('auctions/1/a.jpg')).toBe(
      'auctions/1/a.jpg',
    );
  });

  it('refuses a private key: a client or personal file has no public URL (SC-18)', () => {
    expect(() =>
      new StorageService(config).publicUrlFor('private/auctions/1/matricula/a.pdf'),
    ).toThrow('no public URL');
  });
});
