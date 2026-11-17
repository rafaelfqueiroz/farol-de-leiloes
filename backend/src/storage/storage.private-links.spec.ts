// SPEC-002 BR-002-08 / BR-002-09 / SC-18: client files are linked per request for 60 seconds, never
// through a public URL, and neither the key nor the link reaches a log. The presigner signs locally
// (no request leaves the process, TS-07), so the link it builds is inspected directly.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import {
  isPrivateFileKey,
  PRIVATE_FILE_LINK_SECONDS,
  PRIVATE_FILE_PREFIX,
  StorageService,
} from './storage.service.js';

const config = {
  accountId: 'test-account',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  bucket: 'test-bucket',
  publicUrl: 'https://cdn.test',
};

const KEY = `${PRIVATE_FILE_PREFIX}offices/64b7f0000000000000000a01/3f9c2b7e.pdf`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('StorageService.issuePrivateFileLink (SC-18)', () => {
  it('BR-002-09: signs a GET of the private object that expires after 60 seconds', async () => {
    const link = new URL(await new StorageService(config).issuePrivateFileLink(KEY));

    expect(PRIVATE_FILE_LINK_SECONDS).toBe(60);
    expect(link.hostname).toBe('test-bucket.test-account.r2.cloudflarestorage.com');
    expect(link.pathname).toBe(`/${KEY}`);
    expect(link.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(link.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('BR-002-08: never builds a public URL for a private file', async () => {
    const link = await new StorageService(config).issuePrivateFileLink(KEY);

    expect(link.startsWith(config.publicUrl)).toBe(false);
  });

  it('takes no expiry from its caller: the 60 seconds are fixed', () => {
    expect(StorageService.prototype.issuePrivateFileLink.length).toBe(1);
  });

  it.each([
    ['a public catalogue key', 'documents/A1/edital.pdf'],
    ['the bare prefix', PRIVATE_FILE_PREFIX],
    ['a key climbing out of the prefix', `${PRIVATE_FILE_PREFIX}../images/A1.jpg`],
    ['an empty segment', `${PRIVATE_FILE_PREFIX}offices//a.pdf`],
    ['a dot segment', `${PRIVATE_FILE_PREFIX}./a.pdf`],
    ['an operator object', { $ne: null }],
  ])('refuses %s', async (_case, key) => {
    await expect(new StorageService(config).issuePrivateFileLink(key as string)).rejects.toThrow(
      'Not a private file key (SC-18)',
    );
    expect(isPrivateFileKey(key)).toBe(false);
  });

  it('refuses when R2 is not configured, without inventing a link', async () => {
    await expect(
      new StorageService({ ...config, secretAccessKey: '' }).issuePrivateFileLink(KEY),
    ).rejects.toThrow('R2 not configured');
  });

  it('SC-18: getSignedUrl will not sign a private file for longer', async () => {
    await expect(new StorageService(config).getSignedUrl(KEY, 3600)).rejects.toThrow(
      /issuePrivateFileLink only/,
    );
  });

  it('SC-15: neither the key nor the link is logged', async () => {
    const logged: unknown[] = [];
    for (const level of ['log', 'debug', 'warn', 'error', 'verbose'] as const) {
      vi.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
        logged.push(...args);
      });
    }
    const service = new StorageService(config);

    const link = await service.issuePrivateFileLink(KEY);

    const text = JSON.stringify(logged);
    expect(text).not.toContain(KEY);
    expect(text).not.toContain(link);
  });

  it('SC-15: a private key is never written in the other operations’ log lines', async () => {
    const logged: unknown[] = [];
    vi.spyOn(Logger.prototype, 'debug').mockImplementation((...args: unknown[]) => {
      logged.push(...args);
    });
    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(...args);
    });
    const { S3Client } = await import('@aws-sdk/client-s3');
    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async () => ({}));
    const service = new StorageService(config);

    await service.uploadBuffer(KEY, Buffer.from([1]), 'application/pdf');
    await service.deleteFile(KEY);
    await expect(service.downloadBuffer(KEY)).rejects.toThrow('[private file]');

    expect(JSON.stringify(logged)).not.toContain(KEY);
    expect(JSON.stringify(logged)).toContain('[private file]');
  });
});
