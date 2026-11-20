// SPEC-010 BR-010-03 / AR-08 / AR-30: the only file that touches the `consents` model. It inserts
// and reads; it has no update and no delete (insert-only, held by
// test/structural/privacy-insert-only.spec.ts). Every method takes the account's id from the
// authenticated session, never from a request body (BR-002-11).
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import type {
  AcceptanceMethod,
  LegalDocumentRef,
  LegalDocumentType,
} from './domain/legal-versions.js';
import { type ConsentDocument, ConsentEntity } from './schemas/consent.schema.js';

/** 11000: MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

export interface NewAcceptance {
  readonly userId: string;
  readonly documentType: LegalDocumentType;
  readonly version: string;
  readonly contentHash: string;
  readonly acceptedAt: Date;
  readonly method: AcceptanceMethod;
}

/** What the account may see of its own acceptance. */
export interface AcceptanceRecord {
  readonly documentType: LegalDocumentType;
  readonly version: string;
  readonly acceptedAt: Date;
  readonly method: AcceptanceMethod;
}

/** SC-10: the `$or` is server-built from registry values, never from a request. */
const anyOf = (refs: readonly LegalDocumentRef[]) =>
  refs.map((ref) => ({ documentType: { $eq: ref.type }, version: { $eq: ref.version } }));

@Injectable()
export class ConsentsRepository {
  constructor(@InjectModel(ConsentEntity.name) private readonly model: Model<ConsentDocument>) {}

  /**
   * Inserts the acceptance; false when the account already accepted that version (the unique index
   * decides, so a repeat and twenty accepts at the same moment all end with one row).
   */
  async insert(entry: NewAcceptance): Promise<boolean> {
    try {
      await this.model.create({ ...entry, userId: new Types.ObjectId(entry.userId) });
      return true;
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) return false;
      throw error;
    }
  }

  /** How many of `refs` the account accepted: one indexed query (the terms guard runs it per request). */
  async countAccepted(userId: string, refs: readonly LegalDocumentRef[]): Promise<number> {
    if (refs.length === 0) return 0;
    return this.model
      .countDocuments({ userId: { $eq: new Types.ObjectId(userId) }, $or: anyOf(refs) })
      .exec();
  }

  /** Which of `refs` the account accepted. */
  async findAccepted(
    userId: string,
    refs: readonly LegalDocumentRef[],
  ): Promise<LegalDocumentRef[]> {
    if (refs.length === 0) return [];
    const rows = await this.model
      .find({ userId: { $eq: new Types.ObjectId(userId) }, $or: anyOf(refs) })
      .select('documentType version')
      .lean()
      .exec();
    return rows.map((row) => ({ type: row.documentType, version: row.version }));
  }

  /** Every acceptance of the account, newest first (BR-010-04). */
  async listForUser(userId: string): Promise<AcceptanceRecord[]> {
    const rows = await this.model
      .find({ userId: { $eq: new Types.ObjectId(userId) } })
      .sort({ acceptedAt: -1, _id: -1 })
      .select('documentType version acceptedAt method')
      .lean()
      .exec();
    return rows.map((row) => ({
      documentType: row.documentType,
      version: row.version,
      acceptedAt: row.acceptedAt,
      method: row.method,
    }));
  }
}
