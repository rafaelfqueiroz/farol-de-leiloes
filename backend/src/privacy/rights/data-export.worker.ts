// SPEC-010 BR-010-08..11, DL-010-06: builds the data exports automatically (no manual work, the legal
// deadline is 15 days and the worker runs every couple of minutes), and ends their life after 7 days.
//
// Building (`processQueued`): claims the oldest queued export (a lease, the file key chosen in the
// same update), collects what the registry's providers hold about the account UNDER ITS OWN
// ACCESS CONTEXT (`AccessContextFactory.forAccount`: it cannot include more than the account sees as
// itself, BR-010-10), writes the JSON to the PRIVATE bucket and only then marks it ready, in ONE
// update conditional on the export still being queued and the claim still held. That condition is
// the whole race rule: a closure that cancelled the export meanwhile makes it match nothing, and the
// worker then deletes the file it just wrote. Without R2_PRIVATE_BUCKET the export fails with a
// stable code; it never falls back to the public bucket (SC-18).
//
// Expiring (`expireDue`): a ready export past `expiresAt` has its file deleted and becomes expired;
// the files of failed and cancelled exports (and of any row that lost a race) are deleted too.
//
// SC-15: the export's content is never logged, nor is a key or an id of a person; only counts.
import { randomBytes, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { AccessContextFactory } from '../../access/access-context.js';
import { Clock } from '../../common/clock/clock.js';
import businessConfig from '../../config/business.config.js';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import { StorageService } from '../../storage/storage.service.js';
import { UsersService } from '../../users/users.service.js';
import { type ExportErrorCode, exportExpiresAt, isLiveExport } from '../domain/data-export.js';
import { buildExportDocument } from '../domain/export-document.js';
import { PersonalDataRegistry } from '../registry/personal-data-registry.js';
import { DataExportsRepository } from './data-exports.repository.js';

/** How long a worker holds the claim on one export; a run takes seconds. */
export const EXPORT_CLAIM_LEASE_MS = 10 * 60 * 1000;
/** Bounds one run: the rest waits for the next (every couple of minutes). */
export const EXPORT_BATCH_SIZE = 10;
/** Bounds one expiry run. */
export const EXPIRY_BATCH_SIZE = 100;

/** `private/exports/<random>.json`: random, no personal data in the key (SC-18). */
export function newExportFileKey(): string {
  return `private/exports/${randomBytes(24).toString('hex')}.json`;
}

export interface BuildOutcome {
  readonly ready: number;
  readonly failed: number;
  /** Built, but the export was cancelled meanwhile: the file was deleted. */
  readonly discarded: number;
}

export interface ExpiryOutcome {
  readonly expired: number;
  /** Files of failed or cancelled exports deleted. */
  readonly cleaned: number;
  /** Files that could not be deleted this time (storage unavailable); retried next run. */
  readonly failed: number;
}

@Injectable()
export class DataExportWorker {
  private readonly logger = new Logger(DataExportWorker.name);

  constructor(
    private readonly exports: DataExportsRepository,
    private readonly registry: PersonalDataRegistry,
    private readonly contexts: AccessContextFactory,
    private readonly users: UsersService,
    private readonly storage: StorageService,
    private readonly clock: Clock, // AR-24
    @Inject(businessConfig.KEY) private readonly config: ConfigType<typeof businessConfig>,
  ) {}

  /** Whether anything waits to be built (a cheap peek before the job takes its lock). */
  hasWork(): Promise<boolean> {
    return this.exports.hasQueued();
  }

  /** Builds queued exports, at most `EXPORT_BATCH_SIZE`; never throws for one export's failure. */
  async processQueued(): Promise<BuildOutcome> {
    let ready = 0;
    let failed = 0;
    let discarded = 0;
    for (let n = 0; n < EXPORT_BATCH_SIZE; n += 1) {
      const token = randomUUID();
      const now = this.clock.now();
      const claimed = await this.exports.claimNextQueued(
        token,
        newExportFileKey(),
        now,
        new Date(now.getTime() + EXPORT_CLAIM_LEASE_MS),
      );
      if (!claimed?.fileKey) break;

      const outcome = await this.buildOne(claimed.id, claimed.userId, claimed.fileKey, token);
      if (outcome === 'ready') ready += 1;
      else if (outcome === 'discarded') discarded += 1;
      else failed += 1;
    }
    return { ready, failed, discarded };
  }

  private async buildOne(
    id: string,
    userId: string,
    fileKey: string,
    token: string,
  ): Promise<'ready' | 'failed' | 'discarded'> {
    // SC-18: no private bucket, no export; never the public one.
    if (!this.storage.isPrivateStorageConfigured()) {
      return this.fail(id, token, 'EXPORT_STORAGE_UNAVAILABLE');
    }

    let body: Buffer | null;
    try {
      body = await this.build(userId);
    } catch (error) {
      this.logger.warn(`A data export could not be built: ${jobErrorCode(error)}`);
      return this.fail(id, token, 'EXPORT_BUILD_FAILED');
    }
    // The account is no longer active (closed or deactivated since the request): no file at all.
    if (body === null) return this.fail(id, token, 'EXPORT_ACCOUNT_NOT_ACTIVE');

    try {
      await this.storage.uploadBuffer(fileKey, body, 'application/json');
    } catch (error) {
      this.logger.warn(`A data export could not be stored: ${jobErrorCode(error)}`);
      // The object may have been written before the failure; the row keeps its key either way and
      // the cleanup deletes the file (idempotent).
      return this.fail(id, token, 'EXPORT_STORAGE_UNAVAILABLE');
    }

    const readyAt = this.clock.now();
    const becameReady = await this.exports.markReady(
      id,
      token,
      readyAt,
      exportExpiresAt(readyAt, this.config.privacy.exportTtlDays),
    );
    if (becameReady) return 'ready';

    // The export was cancelled (a closure) or taken over since the claim: it is no longer ours to
    // publish. If it is no longer live, nobody references the file: delete it now. If it is still
    // queued another worker owns the same key and will publish it: leave the file alone.
    await this.deleteOwnFileOfLostExport(id, fileKey);
    return 'discarded';
  }

  /** The export document of the account, as UTF-8 JSON; null when the account is not active. */
  private async build(userId: string): Promise<Buffer | null> {
    const account = await this.users.findById(userId);
    if (!account || (account.status ?? 'active') !== 'active') return null;
    // BR-010-10: the account's own context, built from its CURRENT relationships (AR-13); the
    // providers read through it, so the export holds nothing the account would not see as itself.
    const ctx = await this.contexts.forAccount({ userId, isAdmin: account.isAdmin === true });
    const sections = await this.registry.collect(ctx);
    return Buffer.from(JSON.stringify(buildExportDocument(this.clock.now(), sections)), 'utf8');
  }

  private async fail(id: string, token: string, code: ExportErrorCode): Promise<'failed'> {
    await this.exports.markFailed(id, token, code);
    return 'failed';
  }

  /**
   * The worker lost its export after writing the file (the update to `ready` matched nothing). Its
   * row decides what to do with the file under the key the worker chose before writing:
   * - gone (the purge deleted it): nobody references the file, delete it;
   * - no longer live (cancelled by a closure, failed, expired): delete it and clear the key and the
   *   claim; a failed delete leaves the key on the row and the cleanup retries;
   * - still live (queued: another worker took the lease over and owns the same key): leave it.
   */
  private async deleteOwnFileOfLostExport(id: string, fileKey: string): Promise<void> {
    const row = await this.exports.findById(id);
    if (row && isLiveExport(row.status)) return;
    if (!(await this.storage.deleteFile(fileKey))) {
      if (!row) {
        // No row left to retry from: say so, with a count-free code (SC-15: never the key).
        this.logger.error('EXPORT_ORPHAN_FILE: a data export file could not be deleted');
      }
      return;
    }
    if (row) await this.exports.clearFileKey(id);
  }

  /**
   * The expiry run: ready exports past their time are deleted (file, then the key and the status),
   * then the files still named by failed, cancelled and expired rows. A file that cannot be deleted
   * keeps its row as it is and is tried again next run.
   */
  async expireDue(): Promise<ExpiryOutcome> {
    let expired = 0;
    let cleaned = 0;
    let failed = 0;

    for (const due of await this.exports.findDueForExpiry(this.clock.now(), EXPIRY_BATCH_SIZE)) {
      if (due.fileKey && !(await this.storage.deleteFile(due.fileKey))) {
        failed += 1;
        continue;
      }
      if (await this.exports.markExpired(due.id)) expired += 1;
    }

    for (const stale of await this.exports.findWithStaleFile(this.clock.now(), EXPIRY_BATCH_SIZE)) {
      if (stale.fileKey && (await this.storage.deleteFile(stale.fileKey))) {
        await this.exports.clearFileKey(stale.id);
        cleaned += 1;
      } else {
        failed += 1;
      }
    }
    return { expired, cleaned, failed };
  }
}
