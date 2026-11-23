// SC-24 / SC-19 / SC-15: the URLs the storage copies fetch come from Caixa's data, which is
// untrusted. A URL that is not on Caixa's own site (https, same origin, no credentials) is never
// requested, and a URL never reaches a log line: the property code does.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { S3Client } from '@aws-sdk/client-s3';
import { StorageService } from './storage.service.js';
import { spyOnLogger } from '../../test/support/logger-spy.js';

const config = {
  accountId: 'test-account',
  accessKeyId: 'test-key',
  secretAccessKey: 'test-secret',
  bucket: 'test-bucket',
  publicUrl: 'https://cdn.test',
};
const ON_SITE = 'https://venda-imoveis.caixa.gov.br/fotos/F0000000000000.jpg';
const fetchStub = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchStub);
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async () => ({}));
});

afterEach(() => {
  fetchStub.mockReset();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NOT_ON_SITE = [
  'https://evil.example/fotos/F1.jpg',
  'http://venda-imoveis.caixa.gov.br/fotos/F1.jpg',
  'https://user:secret@venda-imoveis.caixa.gov.br/fotos/F1.jpg',
  'https://venda-imoveis.caixa.gov.br.evil.example/fotos/F1.jpg',
  'https://venda-imoveis.caixa.gov.br:8443/fotos/F1.jpg',
  'http://169.254.169.254/latest/meta-data',
  'http://[::1',
];

describe('StorageService: Caixa URLs stay on Caixa', () => {
  it.each(NOT_ON_SITE)('does not request %s for an image, and logs no URL', async (url) => {
    const logger = spyOnLogger();

    await expect(new StorageService(config).uploadImageFromUrl(url, 'A1')).resolves.toBeNull();

    expect(fetchStub).not.toHaveBeenCalled();
    expect(logger.loggedText()).toContain('A1');
    expect(logger.loggedText()).not.toContain(url);
    expect(logger.loggedText()).not.toContain('secret');
  });

  it.each(NOT_ON_SITE)('does not request %s for a document, and logs no URL', async (url) => {
    const logger = spyOnLogger();

    await expect(
      new StorageService(config).uploadDocumentFromUrl(url, 'A1', 'edital'),
    ).resolves.toBeNull();

    expect(fetchStub).not.toHaveBeenCalled();
    expect(logger.loggedText()).toContain('A1');
    expect(logger.loggedText()).not.toContain(url);
  });

  it('still fetches a URL on the site, with the honest user agent', async () => {
    fetchStub.mockResolvedValue(new Response(new Uint8Array([1])));

    await expect(
      new StorageService(config).uploadImageFromUrl(ON_SITE, 'A1'),
    ).resolves.toMatchObject({ key: 'images/A1.jpg' });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    expect(fetchStub.mock.calls[0]?.[1]).toMatchObject({
      headers: { 'User-Agent': 'FarolDosLeiloes/1.0' },
    });
  });

  it('logs the property code, not the URL, when Caixa answers an error status', async () => {
    const logger = spyOnLogger();
    fetchStub.mockResolvedValue(new Response('gone', { status: 404 }));
    const service = new StorageService(config);

    await service.uploadImageFromUrl(ON_SITE, 'A1');
    await service.uploadDocumentFromUrl(ON_SITE, 'A2', 'matricula');

    expect(logger.loggedText()).toContain('A1');
    expect(logger.loggedText()).toContain('A2');
    expect(logger.loggedText()).toContain('404');
    expect(logger.loggedText()).not.toContain('venda-imoveis.caixa.gov.br');
    expect(logger.loggedText()).not.toContain('F0000000000000');
  });

  it('logs the property code, not the URL, when the download or the upload throws', async () => {
    const logger = spyOnLogger();
    fetchStub.mockRejectedValue(new Error(`connect failed ${ON_SITE}`));
    const service = new StorageService(config);

    await expect(service.uploadImageFromUrl(ON_SITE, 'A1')).resolves.toBeNull();
    await expect(service.uploadDocumentFromUrl(ON_SITE, 'A2', 'edital')).resolves.toBeNull();

    expect(logger.loggedText()).toContain('A1');
    expect(logger.loggedText()).toContain('A2');
    expect(logger.loggedText()).not.toContain('venda-imoveis.caixa.gov.br');
  });
});
