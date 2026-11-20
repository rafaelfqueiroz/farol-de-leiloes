// SPEC-010 BR-010-27 / AR-08 / AR-30: the only file that touches the `whatsappConsents` model.
// Insert and read, nothing else (held by test/structural/privacy-insert-only.spec.ts).
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import type { WhatsappAction, WhatsappMethod } from './domain/whatsapp-consent.js';
import {
  type WhatsappConsentDocument,
  WhatsappConsentEntity,
} from './schemas/whatsapp-consent.schema.js';

export interface NewWhatsappAnswer {
  readonly userId: string;
  readonly action: WhatsappAction;
  readonly method: WhatsappMethod;
  readonly textVersion: string;
  readonly at: Date;
  /** The account's consentResetAt when it answered (null: never reset), see consent.schema.ts. */
  readonly consentResetAt: Date | null;
}

export interface WhatsappAnswer {
  readonly action: WhatsappAction;
  readonly method: WhatsappMethod;
  readonly textVersion: string;
  readonly at: Date;
}

@Injectable()
export class WhatsappConsentRepository {
  constructor(
    @InjectModel(WhatsappConsentEntity.name)
    private readonly model: Model<WhatsappConsentDocument>,
  ) {}

  async insert(entry: NewWhatsappAnswer): Promise<void> {
    await this.model.create({ ...entry, userId: new Types.ObjectId(entry.userId) });
  }

  /**
   * The account's latest answer under its CURRENT consent generation (by instant, then by
   * insertion), or null if it never answered under it: an answer given by whoever registered the
   * address before a takeover (DL-001-02) is not the owner's and is not found.
   */
  async latest(userId: string, consentResetAt: Date | null): Promise<WhatsappAnswer | null> {
    const row = await this.model
      .findOne({
        userId: { $eq: new Types.ObjectId(userId) },
        consentResetAt: { $eq: consentResetAt },
      })
      .sort({ at: -1, _id: -1 })
      .select('action method textVersion at')
      .lean()
      .exec();
    return row === null
      ? null
      : { action: row.action, method: row.method, textVersion: row.textVersion, at: row.at };
  }
}
