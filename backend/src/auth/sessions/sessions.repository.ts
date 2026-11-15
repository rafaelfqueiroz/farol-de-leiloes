import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { serverOperators } from '../../common/mongo/query-safety.js';
import { SessionEntity } from './session.schema.js';

/** AR-08: the only file that touches the `sessions` model. */
@Injectable()
export class SessionsRepository {
  constructor(@InjectModel(SessionEntity.name) private readonly model: Model<SessionEntity>) {}

  async insert(session: { id: string; userId: string; expiresAt: Date }): Promise<void> {
    await this.model.create({
      _id: session.id,
      userId: new Types.ObjectId(session.userId),
      expiresAt: session.expiresAt,
    });
  }

  /** True when the session exists, belongs to the user, is not revoked and has not expired. */
  async isActive(id: string, userId: string, now: Date): Promise<boolean> {
    const found = await this.model.exists({
      _id: { $eq: id },
      userId: { $eq: new Types.ObjectId(userId) },
      revokedAt: null,
      expiresAt: serverOperators({ $gt: now }),
    });
    return found !== null;
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
}
