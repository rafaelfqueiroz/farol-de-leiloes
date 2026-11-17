// SPEC-002 BR-002-24..BR-002-26: the only file that touches the supportAccessGrants model (AR-08).
// A grant is inserted when opened and changed exactly once afterwards, by the end transition
// (`endIfOpen`, `endOpenForSupportRequest`): a conditional update from 'open' to 'ended' that never
// touches anything else. There is no other update and no delete
// (test/structural/admin-access-append-only.spec.ts).
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { isObjectIdString } from '../access/owner-filter.js';
import type { GrantEndReason } from './domain/grant-validity.js';
import {
  type GrantStatus,
  type SupportAccessGrantDocument,
  SupportAccessGrantEntity,
} from './schemas/support-access-grant.schema.js';

/** A grant as stored, detached from its document (ids as hex strings). */
export interface StoredGrant {
  readonly id: string;
  readonly supportRequestId: string;
  readonly adminUserId: string;
  readonly requesterUserId: string;
  readonly openedAt: Date;
  readonly expiresAt: Date;
  readonly status: GrantStatus;
  readonly endedAt?: Date;
  readonly endReason?: GrantEndReason;
}

export interface NewGrant {
  readonly supportRequestId: string;
  readonly adminUserId: string;
  readonly requesterUserId: string;
  readonly openedAt: Date;
  readonly expiresAt: Date;
}

interface GrantRow {
  _id: { toHexString(): string };
  supportRequestId: { toHexString(): string };
  adminUserId: { toHexString(): string };
  requesterUserId: { toHexString(): string };
  openedAt: Date;
  expiresAt: Date;
  status: GrantStatus;
  endedAt?: Date;
  endReason?: GrantEndReason;
}

function toStored(row: GrantRow): StoredGrant {
  return Object.freeze({
    id: row._id.toHexString(),
    supportRequestId: row.supportRequestId.toHexString(),
    adminUserId: row.adminUserId.toHexString(),
    requesterUserId: row.requesterUserId.toHexString(),
    openedAt: row.openedAt,
    expiresAt: row.expiresAt,
    status: row.status,
    ...(row.endedAt ? { endedAt: row.endedAt } : {}),
    ...(row.endReason ? { endReason: row.endReason } : {}),
  });
}

/** MongoDB's duplicate-key error: the partial unique index refused a second open grant. */
function isDuplicateKey(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 11000;
}

@Injectable()
export class SupportAccessGrantRepository {
  constructor(
    @InjectModel(SupportAccessGrantEntity.name)
    private readonly grants: Model<SupportAccessGrantDocument>,
  ) {}

  /**
   * Inserts an open grant, or answers null when the support request already has one that has not
   * ended (the partial unique index, BR-002-24): the caller then reads that one. Race-safe.
   */
  async insertOpen(grant: NewGrant): Promise<StoredGrant | null> {
    try {
      const [created] = await this.grants.create([{ ...grant, status: 'open' }]);
      if (!created) throw new Error('MongoDB created no grant');
      return toStored(created.toObject() as unknown as GrantRow);
    } catch (error) {
      if (isDuplicateKey(error)) return null;
      throw error;
    }
  }

  /** The grant with this id IF it belongs to this admin; null otherwise, alike for every miss. */
  async findForAdmin(grantId: string, adminUserId: string): Promise<StoredGrant | null> {
    if (!isObjectIdString(grantId) || !isObjectIdString(adminUserId)) return null;
    const row = await this.grants
      .findOne({ _id: { $eq: grantId }, adminUserId: { $eq: adminUserId } })
      .lean<GrantRow>()
      .exec();
    return row ? toStored(row) : null;
  }

  /** The grant of this support request that has not ended, if any. */
  async findOpenForSupportRequest(supportRequestId: string): Promise<StoredGrant | null> {
    if (!isObjectIdString(supportRequestId)) return null;
    const row = await this.grants
      .findOne({ supportRequestId: { $eq: supportRequestId }, status: { $eq: 'open' } })
      .lean<GrantRow>()
      .exec();
    return row ? toStored(row) : null;
  }

  /**
   * THE END TRANSITION (BR-002-26), by grant: 'open' → 'ended', only if still open, so a grant ends
   * once and its first recorded reason stays. True when this call ended it.
   */
  async endIfOpen(grantId: string, endedAt: Date, endReason: GrantEndReason): Promise<boolean> {
    if (!isObjectIdString(grantId)) return false;
    const result = await this.grants
      .updateOne(
        { _id: { $eq: grantId }, status: { $eq: 'open' } },
        { $set: { status: 'ended', endedAt, endReason } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** THE END TRANSITION, by support request (SPEC-009 closes it or the permission is withdrawn). */
  async endOpenForSupportRequest(
    supportRequestId: string,
    endedAt: Date,
    endReason: GrantEndReason,
  ): Promise<boolean> {
    if (!isObjectIdString(supportRequestId)) return false;
    const result = await this.grants
      .updateOne(
        { supportRequestId: { $eq: supportRequestId }, status: { $eq: 'open' } },
        { $set: { status: 'ended', endedAt, endReason } },
      )
      .exec();
    return result.modifiedCount === 1;
  }
}
