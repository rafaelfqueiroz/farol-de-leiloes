// SPEC-004 BR-004-22, SC-18: the link to the platform's private matrícula copy. Hand-written fakes
// of the property reader and of the private-file port (TS-03, TS-07).
import { describe, expect, it } from 'vitest';
import { FakeCopyStorage } from '../../../test/fakes/fake-copy-storage.js';
import { DomainError } from '../../common/errors/domain-error.js';
import type { StorageService } from '../../storage/storage.service.js';
import type { AuctionsService } from '../auctions.service.js';
import { AuctionDocumentsController } from './auction-documents.controller.js';
import { AuctionDocumentsService } from './auction-documents.service.js';

const KEY = 'private/auctions/0001/matricula/abc.pdf';

function setup(matricula: { storageKey?: string } | null | undefined) {
  const storage = new FakeCopyStorage();
  storage.privateFiles.set(KEY, { body: Buffer.from('%PDF-1.7'), contentType: 'application/pdf' });
  const auctions = {
    findDocumentByCode: async (code: string) => (code === '0001' ? { matricula } : null),
  } as unknown as AuctionsService;
  const service = new AuctionDocumentsService(auctions, storage as unknown as StorageService);
  return { storage, service };
}

describe('AuctionDocumentsService', () => {
  it('issues a 60-second link for a property with a private matrícula copy', async () => {
    const { storage, service } = setup({ storageKey: KEY });

    const link = await service.issueMatriculaLink('0001');

    expect(link.expiresInSeconds).toBe(60);
    expect(link.url).toContain('X-Amz-Expires=60');
    expect(storage.linkRequests).toEqual([KEY]);
  });

  it.each([
    ['a property with no matrícula copy', null],
    ['a legacy copy in the public bucket', { storageKey: 'documents/0001/matricula.pdf' }],
    ['a stored matrícula with no key', {}],
  ])('refuses %s: no link, no key signed', async (_, matricula) => {
    const { storage, service } = setup(matricula);

    await expect(service.issueMatriculaLink('0001')).rejects.toEqual(
      new DomainError('AUCTION_NOT_FOUND'),
    );
    expect(storage.linkRequests).toEqual([]);
  });

  it('refuses a property that does not exist', async () => {
    const { service } = setup({ storageKey: KEY });

    await expect(service.issueMatriculaLink('9999')).rejects.toBeInstanceOf(DomainError);
  });

  it('is what the route answers with', async () => {
    const { service } = setup({ storageKey: KEY });

    const answer = await new AuctionDocumentsController(service).matriculaLink('0001');

    expect(answer.expiresInSeconds).toBe(60);
  });
});
