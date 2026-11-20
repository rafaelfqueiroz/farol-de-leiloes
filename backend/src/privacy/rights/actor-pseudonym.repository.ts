// SPEC-010 BR-010-28 / AR-08: the only file that touches the `actorPseudonyms` model.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import { ActorPseudonymEntity } from '../schemas/actor-pseudonym.schema.js';

/** 11000: MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

@Injectable()
export class ActorPseudonymRepository {
  constructor(
    @InjectModel(ActorPseudonymEntity.name) private readonly model: Model<ActorPseudonymEntity>,
  ) {}

  /** The person's pseudonym in the journey, or null when they have none yet. */
  async find(journeyId: string, userId: string): Promise<string | null> {
    const row = await this.model
      .findOne({
        journeyId: { $eq: new Types.ObjectId(journeyId) },
        userId: { $eq: new Types.ObjectId(userId) },
      })
      .select('pseudonym')
      .lean()
      .exec();
    return row?.pseudonym ?? null;
  }

  /** Inserts one; false when a unique index refused it (the person already has one, or a clash). */
  async insert(journeyId: string, userId: string, pseudonym: string): Promise<boolean> {
    try {
      await this.model.create({
        journeyId: new Types.ObjectId(journeyId),
        userId: new Types.ObjectId(userId),
        pseudonym,
      });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) return false;
      throw error;
    }
  }

  /**
   * Cuts the link between the person and every label they have: `userId` becomes null, the
   * pseudonym stays. Idempotent (a second call matches nothing). Answers how many rows it detached.
   */
  async detachUser(userId: string): Promise<number> {
    const result = await this.model
      .updateMany({ userId: { $eq: new Types.ObjectId(userId) } }, { $set: { userId: null } })
      .exec();
    return result.modifiedCount;
  }

  /** The journeys and labels of the account (the export and "my data"). */
  async labelsOf(userId: string): Promise<{ journeyId: string; pseudonym: string }[]> {
    const rows = await this.model
      .find({ userId: { $eq: new Types.ObjectId(userId) } })
      .sort({ _id: 1 })
      .select('journeyId pseudonym')
      .lean()
      .exec();
    return rows.map((row) => ({
      journeyId: row.journeyId.toHexString(),
      pseudonym: row.pseudonym,
    }));
  }
}
