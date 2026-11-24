// SPEC-004 BR-004-22, BR-004-30: what is copied for one property after its page was read, and what
// the copies mean for its versions. The files come from a stub of the port's `fetchFile`; the
// buckets are a fake (TS-07).
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { FakeCopyStorage } from '../../../test/fakes/fake-copy-storage.js';
import { aStoredProperty } from '../../../test/fakes/fake-enrichment-repository.js';
import { jpegVariant, pdfVariant } from '../../../test/support/file-bytes.js';
import { testBusinessConfig } from '../../../test/support/test-env.js';
import type { StorageService } from '../../storage/storage.service.js';
import { CaixaBlockedError, type CaixaFile, CaixaUnreachableError } from '../caixa/caixa-access.js';
import type { DetailPage } from '../domain/detail-data.js';
import type { StoredDocumentVersion } from '../schemas/auction.schema.js';
import { FileCopier } from './file-copier.js';
import { PropertyCopier } from './property-copier.js';

const NOW = new Date('2026-11-24T12:00:00.000Z');
const SITE = 'https://venda-imoveis.caixa.gov.br';
const hashOf = (body: Buffer) => createHash('sha256').update(body).digest('hex');

const page = (overrides: Partial<DetailPage> = {}): DetailPage => ({
  description: null,
  propertyType: null,
  occupancy: null,
  phaseDates: [],
  prices: { first: null, second: null, single: null },
  paymentMethods: null,
  expenseRules: null,
  photoUrls: [],
  matriculaUrl: null,
  editalUrl: null,
  editalPublishedAt: null,
  ...overrides,
});

function setup(env: Record<string, string> = {}) {
  const storage = new FakeCopyStorage();
  const business = testBusinessConfig(env);
  const copier = new PropertyCopier(
    new FileCopier(storage as unknown as StorageService, business),
    business,
  );
  const files = new Map<string, CaixaFile | Error>();
  const requested: string[] = [];
  const fetchFile = (url: string) => {
    requested.push(new URL(url).pathname);
    const served = files.get(new URL(url).pathname);
    if (served === undefined) return Promise.reject(new CaixaUnreachableError('HTTP_STATUS', 404));
    return served instanceof Error ? Promise.reject(served) : Promise.resolve(served);
  };
  return { storage, copier, files, requested, fetchFile };
}

const version = (overrides: Partial<StoredDocumentVersion> = {}): StoredDocumentVersion => ({
  kind: 'EDITAL',
  file: { originalUrl: `${SITE}/editais/E1.PDF`, mimeType: 'application/pdf', storageKey: 'k1' },
  sourceUrl: `${SITE}/editais/E1.PDF`,
  contentHash: hashOf(pdfVariant('one')),
  retrievedAt: new Date('2026-11-20T12:00:00.000Z'),
  checkedAt: new Date('2026-11-20T12:00:00.000Z'),
  publishedAt: new Date('2026-11-01T12:00:00.000Z'),
  ...overrides,
});

describe('PropertyCopier: the photos', () => {
  it('copies the gallery in page order, up to the configured number, and no more', async () => {
    const env = setup({ ENRICHMENT_MAX_PHOTOS: '2' });
    for (const n of ['1', '2', '3'])
      env.files.set(`/fotos/${n}.jpg`, { body: jpegVariant(n), contentType: 'image/jpeg' });

    const result = await env.copier.plan(
      aStoredProperty('0001'),
      page({ photoUrls: [1, 2, 3].map((n) => `${SITE}/fotos/${n}.jpg`) }),
      env.fetchFile,
      NOW,
    );

    expect(env.requested).toEqual(['/fotos/1.jpg', '/fotos/2.jpg']);
    expect(result.photos?.map((photo) => photo.originalUrl)).toEqual([
      `${SITE}/fotos/1.jpg`,
      `${SITE}/fotos/2.jpg`,
    ]);
  });

  it('does not fetch a photo whose address is already copied, and keeps its stored copy', async () => {
    const env = setup();
    env.files.set('/fotos/2.jpg', { body: jpegVariant('2'), contentType: 'image/jpeg' });
    const copied = {
      originalUrl: `${SITE}/fotos/1.jpg`,
      storageKey: 'auctions/0001/photos/x.jpg',
      mimeType: 'image/jpeg',
    };

    const result = await env.copier.plan(
      aStoredProperty('0001', { photos: [copied] }),
      page({ photoUrls: [`${SITE}/fotos/1.jpg`, `${SITE}/fotos/2.jpg`] }),
      env.fetchFile,
      NOW,
    );

    expect(env.requested).toEqual(['/fotos/2.jpg']);
    expect(result.photos?.[0]).toBe(copied);
    expect(result.photos).toHaveLength(2);
  });

  it('leaves the stored gallery alone when the page lists none or every copy fails', async () => {
    const env = setup();

    const none = await env.copier.plan(aStoredProperty('0001'), page(), env.fetchFile, NOW);
    const failed = await env.copier.plan(
      aStoredProperty('0001'),
      page({ photoUrls: [`${SITE}/fotos/gone.jpg`] }),
      env.fetchFile,
      NOW,
    );

    expect(none.photos).toBeUndefined();
    expect(failed.photos).toBeUndefined();
    expect(failed.rejections).toEqual([{ kind: 'PHOTO', reason: 'UNREACHABLE' }]);
  });

  it('stops on a block while copying', async () => {
    const env = setup();
    env.files.set('/fotos/1.jpg', new CaixaBlockedError('HTTP_429'));

    await expect(
      env.copier.plan(
        aStoredProperty('0001'),
        page({ photoUrls: [`${SITE}/fotos/1.jpg`] }),
        env.fetchFile,
        NOW,
      ),
    ).rejects.toBeInstanceOf(CaixaBlockedError);
  });
});

describe('PropertyCopier: the documents and their versions', () => {
  const EDITAL_ONE = pdfVariant('one');
  const EDITAL_TWO = pdfVariant('two');
  const PUBLISHED = new Date('2026-11-01T12:00:00.000Z');

  it('stores a first edital and matrícula as their first version, with no entry', async () => {
    const env = setup();
    env.files.set('/editais/E1.PDF', { body: EDITAL_ONE, contentType: 'application/pdf' });
    env.files.set('/editais/matricula/XX/1.pdf', {
      body: pdfVariant('m'),
      contentType: 'application/pdf',
    });

    const result = await env.copier.plan(
      aStoredProperty('0001'),
      page({
        editalUrl: `${SITE}/editais/E1.PDF`,
        editalPublishedAt: PUBLISHED,
        matriculaUrl: `${SITE}/editais/matricula/XX/1.pdf`,
      }),
      env.fetchFile,
      NOW,
    );

    expect(
      result.newVersions.map((v) => [v.kind, v.retrievedAt, v.checkedAt, v.publishedAt]),
    ).toEqual([
      ['EDITAL', NOW, NOW, PUBLISHED],
      ['MATRICULA', NOW, NOW, null],
    ]);
    expect(result.edital?.storageKey).toMatch(/^auctions\/0001\/edital\//);
    expect(result.matricula?.storageKey).toMatch(/^private\/auctions\/0001\/matricula\//);
    expect(result.entries).toEqual([]);
    expect(result.checked).toEqual([]);
  });

  it('appends a new version and an entry when the edital is another file; the old version is untouched', async () => {
    const env = setup();
    env.files.set('/editais/E2.PDF', { body: EDITAL_TWO, contentType: 'application/pdf' });
    const previous = version();

    const result = await env.copier.plan(
      aStoredProperty('0001', { documentVersions: [previous] }),
      page({
        editalUrl: `${SITE}/editais/E2.PDF`,
        editalPublishedAt: new Date('2026-11-24T10:00:00Z'),
      }),
      env.fetchFile,
      NOW,
    );

    expect(result.newVersions).toHaveLength(1);
    expect(result.newVersions[0]).toMatchObject({
      kind: 'EDITAL',
      sourceUrl: `${SITE}/editais/E2.PDF`,
    });
    expect(result.entries).toEqual([
      expect.objectContaining({
        type: 'OTHER_FIELD',
        relevant: false,
        field: 'edital',
        oldValue: hashOf(pdfVariant('one')).slice(0, 16),
        newValue: hashOf(EDITAL_TWO).slice(0, 16),
      }),
    ]);
  });

  it('asks for nothing while the stored copy is current and the page says the same', async () => {
    const env = setup();

    const result = await env.copier.plan(
      aStoredProperty('0001', { documentVersions: [version()] }),
      page({ editalUrl: `${SITE}/editais/E1.PDF`, editalPublishedAt: PUBLISHED }),
      env.fetchFile,
      NOW,
    );

    expect(env.requested).toEqual([]);
    expect(result.newVersions).toEqual([]);
  });

  it('marks the version checked, and adds none, when the same file is fetched again after the recheck period', async () => {
    const env = setup();
    env.files.set('/editais/E1.PDF', { body: pdfVariant('one'), contentType: 'application/pdf' });
    const old = version({ checkedAt: new Date('2026-10-01T12:00:00.000Z') });

    const result = await env.copier.plan(
      aStoredProperty('0001', { documentVersions: [old] }),
      page({ editalUrl: `${SITE}/editais/E1.PDF`, editalPublishedAt: PUBLISHED }),
      env.fetchFile,
      NOW,
    );

    expect(env.requested).toEqual(['/editais/E1.PDF']);
    expect(result.newVersions).toEqual([]);
    expect(result.checked).toEqual([
      { kind: 'EDITAL', contentHash: hashOf(pdfVariant('one')), publishedAt: PUBLISHED },
    ]);
  });

  it('judges the newest version of a kind, whatever order other kinds sit in', async () => {
    const env = setup();
    env.files.set('/editais/E3.PDF', { body: pdfVariant('three'), contentType: 'application/pdf' });
    const versions = [
      version({ sourceUrl: `${SITE}/editais/E1.PDF` }),
      version({ kind: 'MATRICULA', sourceUrl: `${SITE}/m.pdf` }),
      version({ sourceUrl: `${SITE}/editais/E2.PDF`, contentHash: hashOf(EDITAL_TWO) }),
    ];

    const result = await env.copier.plan(
      aStoredProperty('0001', { documentVersions: versions }),
      page({ editalUrl: `${SITE}/editais/E3.PDF`, editalPublishedAt: PUBLISHED }),
      env.fetchFile,
      NOW,
    );

    expect(result.entries[0]?.oldValue).toBe(hashOf(EDITAL_TWO).slice(0, 16)); // E2, the newest edital
  });

  it('keeps the page-collected data when a document does not come, and says why by code', async () => {
    const env = setup();
    env.storage.privateConfigured = false;
    env.files.set('/editais/E1.PDF', {
      body: Buffer.from('<html>no</html>'),
      contentType: 'application/pdf',
    });

    const result = await env.copier.plan(
      aStoredProperty('0001'),
      page({
        editalUrl: `${SITE}/editais/E1.PDF`,
        matriculaUrl: `${SITE}/editais/matricula/XX/1.pdf`,
      }),
      env.fetchFile,
      NOW,
    );

    expect(result.newVersions).toEqual([]);
    expect(result.rejections).toEqual([
      { kind: 'EDITAL', reason: 'FILE_WRONG_TYPE' },
      { kind: 'MATRICULA', reason: 'PRIVATE_STORAGE_UNCONFIGURED' },
    ]);
    expect(env.requested).toEqual(['/editais/E1.PDF']); // the matrícula was never asked for
  });

  it('does nothing for a page that names no document', async () => {
    const env = setup();
    const spy = vi.spyOn(env.storage, 'uploadBuffer');

    const result = await env.copier.plan(aStoredProperty('0001'), page(), env.fetchFile, NOW);

    expect(result).toEqual({ newVersions: [], checked: [], entries: [], rejections: [] });
    expect(spy).not.toHaveBeenCalled();
  });
});
