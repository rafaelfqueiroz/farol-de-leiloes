import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { serverOperators } from '../../common/mongo/query-safety.js';
import { SessionEntity } from './session.schema.js';

/** AR-08: the only file that touches the `sessions` model. */
@Injectable()
export class SessionsRepository {
  constructor(@InjectModel(SessionEntity.name) private readonly model: Model<SessionEntity>) {}

  async insert(session: {
    id: string;
    userId: string;
    credentialVersion: number;
    expiresAt: Date;
  }): Promise<void> {
    await this.model.create({
      _id: session.id,
      userId: new Types.ObjectId(session.userId),
      credentialVersion: session.credentialVersion,
      expiresAt: session.expiresAt,
    });
  }

  /**
   * The credential version the session was issued for, or null when it does not exist, does not
   * belong to the user, is revoked or has expired. A session stored before the field counts as 0.
   */
  async activeCredentialVersion(id: string, userId: string, now: Date): Promise<number | null> {
    const found = await this.model
      .findOne({
        _id: { $eq: id },
        userId: { $eq: new Types.ObjectId(userId) },
        revokedAt: null,
        expiresAt: serverOperators({ $gt: now }),
      })
      .select('credentialVersion')
      .lean()
      .exec();
    return found === null ? null : (found.credentialVersion ?? 0);
  }

  async revoke(id: string, now: Date): Promise<void> {
    await this.model.updateOne({ _id: { $eq: id }, revokedAt: null }, { $set: { revokedAt: now } });
  }

  /** Revokes every live session of the user, except `exceptId` when given (BR-001-19). */
  async revokeAllForUser(userId: string, now: Date, exceptId?: string): Promise<void> {
    await this.model.updateMany(
      {
        userId: { $eq: new Types.ObjectId(userId) },
        revokedAt: null,
        ...(exceptId === undefined ? {} : { _id: serverOperators({ $ne: exceptId }) }),
      },
      { $set: { revokedAt: now } },
    );
  }

  /** SPEC-010 BR-010-08: the account's sessions, newest first, instants only (never the id). */
  async listForUser(
    userId: string,
    limit: number,
  ): Promise<{ startedAt: Date; expiresAt: Date; revokedAt?: Date }[]> {
    const rows = await this.model
      .find({ userId: { $eq: new Types.ObjectId(userId) } })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit)
      .select('createdAt expiresAt revokedAt')
      .lean()
      .exec();
    return rows.map((row) => ({
      startedAt: (row as unknown as { createdAt: Date }).createdAt,
      expiresAt: row.expiresAt,
      ...(row.revokedAt ? { revokedAt: row.revokedAt } : {}),
    }));
  }

  /** SPEC-010 BR-010-15 / AR-31: JOB ONLY. Deletes every session of one closed account; idempotent. */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await this.model
      .deleteMany({ userId: { $eq: new Types.ObjectId(userId) } })
      .exec();
    return result.deletedCount;
  }

  /**
   * Binds a live session to a new credential version; true when it was still live. Revoked and
   * expired sessions are left as they are (DL-001-02).
   */
  async rebind(id: string, userId: string, credentialVersion: number, now: Date): Promise<boolean> {
    const result = await this.model.updateOne(
      {
        _id: { $eq: id },
        userId: { $eq: new Types.ObjectId(userId) },
        revokedAt: null,
        expiresAt: serverOperators({ $gt: now }),
      },
      { $set: { credentialVersion } },
    );
    return result.matchedCount > 0;
  }
}
