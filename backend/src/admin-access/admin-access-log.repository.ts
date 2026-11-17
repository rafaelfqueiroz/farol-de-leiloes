// SPEC-002 BR-002-27 / AR-30: the only file that touches the adminAccessLogs model (AR-08). It
// exposes `append` and nothing else: no update, no delete, and no read yet (SPEC-009 and SPEC-010
// add their reads here when they need them, never an update or a delete). Held by
// test/structural/admin-access-append-only.spec.ts.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import {
  type AdminAccessAction,
  type AdminAccessLogDocument,
  AdminAccessLogEntity,
  type LoggedOwnerType,
} from './schemas/admin-access-log.schema.js';

/** One entry to append; ids as hex strings (validated by the caller), `at` from the Clock. */
export interface NewAdminAccessLogEntry {
  readonly adminUserId: string;
  readonly action: AdminAccessAction;
  readonly grantId?: string;
  readonly supportRequestId?: string;
  readonly owner?: { readonly type: LoggedOwnerType; readonly id: string };
  readonly resource?: { readonly type: string; readonly id: string };
  readonly at: Date;
}

const objectId = (id: string) => new Types.ObjectId(id);

@Injectable()
export class AdminAccessLogRepository {
  constructor(
    @InjectModel(AdminAccessLogEntity.name)
    private readonly logs: Model<AdminAccessLogDocument>,
  ) {}

  /**
   * Inserts the entries in one ordered `insertMany`, and resolves only once MongoDB acknowledged
   * them all. Any failure rejects: the caller (GrantReadLogger) then refuses the read (BR-002-27).
   * A failure part-way may leave the first entries written: over-logging a read that is then
   * refused is the safe direction, under-logging one that is answered never happens.
   */
  async append(entries: readonly NewAdminAccessLogEntry[]): Promise<void> {
    if (entries.length === 0) return;
    await this.logs.insertMany(
      entries.map((entry) => ({
        adminUserId: objectId(entry.adminUserId),
        action: entry.action,
        ...(entry.grantId ? { grantId: objectId(entry.grantId) } : {}),
        ...(entry.supportRequestId ? { supportRequestId: objectId(entry.supportRequestId) } : {}),
        ...(entry.owner ? { owner: { type: entry.owner.type, id: objectId(entry.owner.id) } } : {}),
        ...(entry.resource
          ? { resource: { type: entry.resource.type, id: objectId(entry.resource.id) } }
          : {}),
        at: entry.at,
      })),
      { ordered: true },
    );
  }
}
