// SPEC-010 BR-010-08, BR-010-11: asking for, listing and downloading the account's own data export.
// Every method takes the account's id from the authenticated session (BR-002-11); an export of any
// other account is the same not-found as one that does not exist (AR-14, BR-002-12). Building the
// file is the worker's job (data-export.worker.ts), never a request's (AR-31 spirit: no heavy work
// inline).
import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { type Paginated, type PageRequest, paginated } from '../../common/pagination/paginated.js';
import { PRIVATE_FILE_LINK_SECONDS, StorageService } from '../../storage/storage.service.js';
import { downloadVerdict, isExportExpired } from '../domain/data-export.js';
import { DataExportsRepository, type DataExportRecord } from './data-exports.repository.js';

/** The attempts to either insert or find the live export when a concurrent transition races. */
const REQUEST_ATTEMPTS = 3;

/** What the account is shown of an export: never the file key (BR-010-11, SC-18). */
export type DataExportView = Omit<DataExportRecord, 'fileKey' | 'userId'>;

function view(record: DataExportRecord): DataExportView {
  return {
    id: record.id,
    status: record.status,
    requestedAt: record.requestedAt,
    ...(record.readyAt === undefined ? {} : { readyAt: record.readyAt }),
    ...(record.expiresAt === undefined ? {} : { expiresAt: record.expiresAt }),
    ...(record.errorCode === undefined ? {} : { errorCode: record.errorCode }),
  };
}

@Injectable()
export class DataExportService {
  constructor(
    private readonly exports: DataExportsRepository,
    private readonly storage: StorageService,
    private readonly clock: Clock, // AR-24
  ) {}

  /**
   * Queues an export of the account's data, or answers the one it already has live (queued or
   * ready and not past `expiresAt`): one live export per account, whatever races (the partial unique index decides, so twenty
   * requests at once end with one row and all answer it, BR-010-11). The file is built by the worker.
   */
  async request(userId: string): Promise<DataExportView> {
    for (let attempt = 0; attempt < REQUEST_ATTEMPTS; attempt += 1) {
      const created = await this.exports.insertQueued(userId, this.clock.now());
      if (created) return view(created);
      // The live one may have finished (expired, failed) between the two calls: then insert again.
      const live = await this.exports.findLiveOf(userId);
      if (
        live &&
        live.status === 'ready' &&
        live.expiresAt &&
        isExportExpired(live.expiresAt, this.clock.now())
      ) {
        // Ready, but its 7 days are over (the hourly job has not got to it yet): it is not live any
        // more. End it here (its file is deleted by the cleanup) and queue a fresh one.
        await this.exports.expireNow(live.id);
        continue;
      }
      if (live) return view(live);
    }
    throw new Error('A data export could not be queued');
  }

  /** AR-35: the account's exports, newest first. */
  async list(userId: string, page: PageRequest): Promise<Paginated<DataExportView>> {
    const { items, total } = await this.exports.pageOf(userId, page);
    return paginated(items.map(view), total, page);
  }

  /**
   * A 60-second link to the export's file (`StorageService.issuePrivateFileLink`), for its owner
   * only. Another account's id, a missing one and a malformed one are the same NOT_FOUND. Refused
   * with EXPORT_NOT_READY while queued, EXPORT_EXPIRED from `expiresAt` on (half-open: 7 days and 1
   * minute after it was ready is refused), and NOT_FOUND when it failed or was cancelled (there is
   * no file). The link is never stored or logged (SC-15, SC-18).
   */
  async downloadLink(
    userId: string,
    id: string,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const found = await this.exports.findOwned(userId, id);
    if (!found) throw new DomainError('NOT_FOUND');
    switch (downloadVerdict(found, this.clock.now())) {
      case 'not_ready':
        throw new DomainError('EXPORT_NOT_READY');
      case 'expired':
        throw new DomainError('EXPORT_EXPIRED');
      case 'unavailable':
        throw new DomainError('NOT_FOUND');
      case 'ok':
        break;
    }
    if (!found.fileKey) throw new DomainError('EXPORT_EXPIRED');
    return {
      url: await this.storage.issuePrivateFileLink(found.fileKey),
      expiresInSeconds: PRIVATE_FILE_LINK_SECONDS,
    };
  }
}
