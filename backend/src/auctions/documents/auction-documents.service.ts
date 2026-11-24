import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error.js';
import {
  isPrivateFileKey,
  PRIVATE_FILE_LINK_SECONDS,
  StorageService,
} from '../../storage/storage.service.js';
import { AuctionsService } from '../auctions.service.js';

/**
 * SPEC-004 BR-004-22, SC-18, SC-25: the platform's copy of a matrícula is private data (it names
 * the people of the property's registry), so it is never at a public URL. This is where a link to
 * it is issued: per request, 60 seconds, only for a property that has a private copy, and neither
 * the key nor the link is stored or logged. It works for a property that is no longer on Caixa's
 * list (BR-004-22), because it reads the stored copy, not the listing.
 */
@Injectable()
export class AuctionDocumentsService {
  constructor(
    private readonly auctions: AuctionsService,
    private readonly storage: StorageService,
  ) {}

  async issueMatriculaLink(code: string): Promise<{ url: string; expiresInSeconds: number }> {
    const doc = await this.auctions.findDocumentByCode(code);
    const key = doc?.matricula?.storageKey;
    if (!isPrivateFileKey(key)) throw new DomainError('AUCTION_NOT_FOUND');
    return {
      url: await this.storage.issuePrivateFileLink(key),
      expiresInSeconds: PRIVATE_FILE_LINK_SECONDS,
    };
  }
}
