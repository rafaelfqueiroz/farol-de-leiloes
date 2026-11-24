// SPEC-004 BR-004-22, BR-004-30, SC-13, SC-18, SC-24: the copy of one Caixa file. No network, no R2
// (TS-07): the file comes from a stub of the port's `fetchFile`, the bucket is a fake.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FakeCopyStorage } from '../../../test/fakes/fake-copy-storage.js';
import { jpegVariant, pdfVariant } from '../../../test/support/file-bytes.js';
import { spyOnLogger } from '../../../test/support/logger-spy.js';
import { testBusinessConfig } from '../../../test/support/test-env.js';
import type { StorageService } from '../../storage/storage.service.js';
import {
  CaixaBlockedError,
  type CaixaFile,
  CaixaUnreachableError,
  CaixaUrlRefusedError,
} from '../caixa/caixa-access.js';
import { FileCopier } from './file-copier.js';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const URL_ON_SITE = 'https://venda-imoveis.caixa.gov.br/fotos/F1.jpg';
const PHOTO: CaixaFile = { body: jpegVariant('a'), contentType: 'image/jpeg' };
const DOC: CaixaFile = { body: pdfVariant('d'), contentType: 'application/pdf' };

function setup(env: Record<string, string> = {}) {
  const storage = new FakeCopyStorage();
  const copier = new FileCopier(storage as unknown as StorageService, testBusinessConfig(env));
  return { storage, copier };
}
const returning = (file: CaixaFile) => vi.fn(() => Promise.resolve(file));
const failing = (error: unknown) => vi.fn(() => Promise.reject(error as Error));

describe('FileCopier', () => {
  it('stores a photo in the public bucket under a content-hashed key, with its public URL', async () => {
    const { storage, copier } = setup();
    const fetchFile = returning(PHOTO);

    const result = await copier.copy('PHOTO', '0001', URL_ON_SITE, fetchFile, NOW);

    const hash = createHash('sha256').update(PHOTO.body).digest('hex');
    expect(result).toEqual({
      ok: true,
      contentHash: hash,
      file: {
        originalUrl: URL_ON_SITE,
        storageKey: `auctions/0001/photos/${hash.slice(0, 16)}.jpg`,
        publicUrl: `https://files.example.test/auctions/0001/photos/${hash.slice(0, 16)}.jpg`,
        mimeType: 'image/jpeg',
        size: PHOTO.body.length,
        uploadedAt: NOW,
        contentHash: hash,
      },
    });
    expect(fetchFile).toHaveBeenCalledWith(URL_ON_SITE);
    expect(storage.publicFiles.size).toBe(1);
  });

  it('stores a matrícula only in the private bucket, with no public URL (SC-18)', async () => {
    const { storage, copier } = setup();

    const result = await copier.copy(
      'MATRICULA',
      '0001',
      'https://venda-imoveis.caixa.gov.br/editais/matricula/XX/1.pdf',
      returning(DOC),
      NOW,
    );

    expect(result.ok && result.file.storageKey).toMatch(
      /^private\/auctions\/0001\/matricula\/[0-9a-f]{16}\.pdf$/,
    );
    expect(result.ok && result.file.publicUrl).toBeUndefined();
    expect(storage.publicFiles.size).toBe(0);
    expect(storage.privateFiles.size).toBe(1);
  });

  it('gives two different contents two different keys, so a new version never overwrites', async () => {
    const { storage, copier } = setup();

    await copier.copy('EDITAL', '0001', URL_ON_SITE, returning(DOC), NOW);
    await copier.copy(
      'EDITAL',
      '0001',
      URL_ON_SITE,
      returning({ ...DOC, body: pdfVariant('e') }),
      NOW,
    );

    expect(storage.publicFiles.size).toBe(2);
  });

  it('stores the type the bytes show, whatever generic or aliased header came with them (SC-13)', async () => {
    const { storage, copier } = setup();

    const generic = await copier.copy(
      'PHOTO',
      '0001',
      URL_ON_SITE,
      returning({ body: PHOTO.body, contentType: 'application/octet-stream' }),
      NOW,
    );
    const alias = await copier.copy(
      'PHOTO',
      '0002',
      URL_ON_SITE,
      returning({ body: PHOTO.body, contentType: 'image/jpg; charset=binary' }),
      NOW,
    );
    const document = await copier.copy(
      'EDITAL',
      '0003',
      URL_ON_SITE,
      returning({ body: DOC.body, contentType: null }),
      NOW,
    );

    expect(generic.ok && generic.file.mimeType).toBe('image/jpeg');
    expect(alias.ok && alias.file.mimeType).toBe('image/jpeg');
    expect(document.ok && document.file.mimeType).toBe('application/pdf');
    expect([...storage.publicFiles.values()].map((file) => file.contentType).sort()).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/jpeg',
    ]);
  });

  describe('what it will not even ask Caixa for', () => {
    it.each([
      ['an unsafe property number', 'PHOTO', '../x', URL_ON_SITE, {}, 'UNSAFE_CODE'],
      [
        'a missing public bucket',
        'PHOTO',
        '0001',
        URL_ON_SITE,
        { public: false },
        'STORAGE_UNCONFIGURED',
      ],
      [
        'an unset private bucket',
        'MATRICULA',
        '0001',
        URL_ON_SITE,
        { private: false },
        'PRIVATE_STORAGE_UNCONFIGURED',
      ],
      [
        'an address off the site',
        'PHOTO',
        '0001',
        'https://evil.example.test/a.jpg',
        {},
        'OFF_SITE',
      ],
      [
        'a plain http address',
        'PHOTO',
        '0001',
        'http://venda-imoveis.caixa.gov.br/a.jpg',
        {},
        'OFF_SITE',
      ],
      [
        'an address with credentials',
        'PHOTO',
        '0001',
        'https://u:p@venda-imoveis.caixa.gov.br/a.jpg',
        {},
        'OFF_SITE',
      ],
    ] as const)('refuses %s, with no request', async (_, kind, code, url, flags, reason) => {
      const { storage, copier } = setup();
      storage.publicConfigured = !('public' in flags);
      storage.privateConfigured = !('private' in flags);
      const fetchFile = returning(PHOTO);

      const result = await copier.copy(kind, code, url, fetchFile, NOW);

      expect(result).toEqual({ ok: false, reason });
      expect(fetchFile).not.toHaveBeenCalled();
    });

    it('says why a kind cannot be stored before a request is spent on it', () => {
      const { storage, copier } = setup();
      storage.privateConfigured = false;

      expect(copier.unavailableReason('MATRICULA', '0001')).toBe('PRIVATE_STORAGE_UNCONFIGURED');
      expect(copier.unavailableReason('EDITAL', '0001')).toBeNull();
      expect(copier.unavailableReason('PHOTO', 'a/b')).toBe('UNSAFE_CODE');
    });
  });

  describe('what happens to a file that does not come', () => {
    it('stops on a block: it is not a rejection but the end of the pass', async () => {
      const { copier } = setup();

      await expect(
        copier.copy(
          'PHOTO',
          '0001',
          URL_ON_SITE,
          failing(new CaixaBlockedError('REDIRECT_OFF_SITE')),
          NOW,
        ),
      ).rejects.toBeInstanceOf(CaixaBlockedError);
    });

    it('maps the port refusing the address to OFF_SITE and an unreachable file to UNREACHABLE', async () => {
      const { copier } = setup();

      expect(
        await copier.copy('PHOTO', '0001', URL_ON_SITE, failing(new CaixaUrlRefusedError()), NOW),
      ).toEqual({ ok: false, reason: 'OFF_SITE' });
      expect(
        await copier.copy(
          'PHOTO',
          '0001',
          URL_ON_SITE,
          failing(new CaixaUnreachableError('TIMEOUT')),
          NOW,
        ),
      ).toEqual({ ok: false, reason: 'UNREACHABLE' });
    });

    it('does not swallow anything else (a lease lost, a bug)', async () => {
      const { copier } = setup();

      await expect(
        copier.copy('PHOTO', '0001', URL_ON_SITE, failing(new Error('lease')), NOW),
      ).rejects.toThrow('lease');
    });
  });

  describe('what it refuses to keep (SC-13)', () => {
    it.each([
      ['an empty body', { body: Buffer.alloc(0), contentType: 'image/jpeg' }, {}, 'FILE_EMPTY'],
      ['an oversize photo', PHOTO, { ENRICHMENT_MAX_PHOTO_BYTES: '5' }, 'FILE_TOO_LARGE'],
      [
        'HTML as a photo',
        { body: Buffer.from('<html></html>'), contentType: 'image/jpeg' },
        {},
        'FILE_WRONG_TYPE',
      ],
      [
        'a header that contradicts the bytes',
        { body: PHOTO.body, contentType: 'image/png' },
        {},
        'FILE_TYPE_MISMATCH',
      ],
    ] as const)('refuses %s', async (_, file, env, reason) => {
      const { storage, copier } = setup({ ...env });

      const result = await copier.copy('PHOTO', '0001', URL_ON_SITE, returning(file), NOW);

      expect(result).toEqual({ ok: false, reason });
      expect(storage.allKeys()).toEqual([]);
    });

    it('answers STORE_FAILED, logging the code and never the message or a key, when R2 refuses', async () => {
      const logged = spyOnLogger();
      const { storage, copier } = setup();
      storage.failUploads = true;

      const result = await copier.copy('MATRICULA', '0001', URL_ON_SITE, returning(DOC), NOW);

      expect(result).toEqual({ ok: false, reason: 'STORE_FAILED' });
      expect(logged.loggedText()).not.toContain('private/');
      expect(logged.loggedText()).not.toContain('storage unavailable');
    });
  });
});
