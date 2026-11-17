// SPEC-002 BR-002-27: every read of client data under a support access grant is logged with the
// admin, the support request, the owner, the record and the time — BEFORE the data is returned —
// and if the entry cannot be written, the read is refused (fail closed).
//
// The wrappers `readOne` and `readMany` are the ONLY way a grant route reads: the grant's view is
// sealed in its SupportGrantRead (grant-context.ts) and this file is the one place that opens it
// (test/structural/admin-access-append-only.spec.ts). They run the load with that view, append the
// log entries, and only then hand the records back. The view reads client data only — an account's
// own data refuses it (AccountScopedRepository, BR-002-02/23) — and writes nothing (BR-002-25). A route
// that returns what the wrapper returned cannot send a record whose entry was not acknowledged by
// MongoDB; if the append fails they throw AdminAccessLogUnavailableError, a fault, answered as a
// bare 500 INTERNAL_ERROR with no data (ApiExceptionFilter).
//
// A list logs ONE ENTRY PER RECORD returned (never one entry naming a list): the log answers
// "who read this record, of this owner, when" (SPEC-010 data-subject access, the `owner.id` index)
// with one entry shape, and a page of N records is N reads. The N entries go in one insertMany.
import { Injectable, Logger } from '@nestjs/common';
import type { AccessContext, Owner } from '../access/access-context.js';
import { Clock } from '../common/clock/clock.js';
import { logSafeError } from '../common/errors/log-safe-error.js';
import { AdminAccessLogRepository } from './admin-access-log.repository.js';
import { grantContextOf } from './grant-context.js';
import type { LoggedOwnerType } from './schemas/admin-access-log.schema.js';
import { SupportGrantRead } from './support-grant.service.js';

/** What one entry says was read: whose data, and which record. Ids as hex strings. */
export interface GrantReadRecord {
  readonly owner: { readonly type: LoggedOwnerType; readonly id: string };
  readonly resource: { readonly type: string; readonly id: string };
}

/**
 * BR-002-27: the log could not be written, so the read is refused. Carries no data and not the
 * driver's error either (SC-15: a driver message may quote the values it failed on).
 */
export class AdminAccessLogUnavailableError extends Error {
  constructor() {
    super('The admin access log could not be written; the read is refused (BR-002-27)');
    this.name = 'AdminAccessLogUnavailableError';
  }
}

/** The fields every owned record has (AR-11), as a repository returns them. */
export interface OwnedRecordIds {
  readonly _id: { toString(): string };
  readonly ownerType: Owner['ownerType'];
  readonly ownerId: { toString(): string };
}

/** The log entry of an owned record (journey, profile, ...): its owner and its id. */
export function ownedRecordRead(resourceType: string): (record: OwnedRecordIds) => GrantReadRecord {
  return (record) => ({
    owner: { type: record.ownerType, id: record.ownerId.toString() },
    resource: { type: resourceType, id: record._id.toString() },
  });
}

@Injectable()
export class GrantReadLogger {
  private readonly logger = new Logger(GrantReadLogger.name);

  constructor(
    private readonly logs: AdminAccessLogRepository,
    private readonly clock: Clock,
  ) {}

  /** One entry for one record read under the grant; throws when it cannot be written. */
  logRead(read: SupportGrantRead, record: GrantReadRecord): Promise<void> {
    return this.logReads(read, [record]);
  }

  /** One entry per record read under the grant, in one write; throws when it fails. */
  async logReads(read: SupportGrantRead, records: readonly GrantReadRecord[]): Promise<void> {
    // Only a read SupportGrantService validated for this admin and grant is logged as one.
    if (!(read instanceof SupportGrantRead)) {
      throw new Error('A grant read comes from SupportGrantService.contextForRead (BR-002-27)');
    }
    const at = this.clock.now();
    try {
      await this.logs.append(
        records.map((record) => ({
          adminUserId: read.adminUserId,
          action: 'grant_read' as const,
          grantId: read.grantId,
          supportRequestId: read.supportRequestId,
          owner: record.owner,
          resource: record.resource,
          at,
        })),
      );
    } catch (error) {
      // SC-15: the driver's code or class only, never its message (it may quote values).
      this.logger.error(`BR-002-27: admin access log not written (${logSafeError(error)})`);
      throw new AdminAccessLogUnavailableError();
    }
  }

  /**
   * Loads one record with the grant's view and returns it only after its entry is written. A
   * record the requester cannot see comes back null and logs nothing (nothing was read).
   */
  async readOne<T>(
    read: SupportGrantRead,
    load: (ctx: AccessContext) => Promise<T | null>,
    describe: (record: T) => GrantReadRecord,
  ): Promise<T | null> {
    const record = await load(this.viewOf(read));
    if (record === null) return null;
    await this.logRead(read, describe(record));
    return record;
  }

  /** Loads records with the grant's view; returns them once all entries are written. */
  async readMany<T>(
    read: SupportGrantRead,
    load: (ctx: AccessContext) => Promise<readonly T[]>,
    describe: (record: T) => GrantReadRecord,
  ): Promise<readonly T[]> {
    const records = await load(this.viewOf(read));
    await this.logReads(read, records.map(describe));
    return records;
  }

  /** The sealed view of a read SupportGrantService built; throws for anything else. */
  private viewOf(read: SupportGrantRead): AccessContext {
    if (!(read instanceof SupportGrantRead)) {
      throw new Error('A grant read comes from SupportGrantService.contextForRead (BR-002-27)');
    }
    return grantContextOf(read);
  }
}
