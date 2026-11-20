import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';
import {
  WHATSAPP_ACTIONS,
  WHATSAPP_METHODS,
  type WhatsappAction,
  type WhatsappMethod,
} from '../domain/whatsapp-consent.js';
import { makeInsertOnly } from './insert-only.js';

/**
 * SPEC-010 BR-010-27, BR-010-03: one answer to the WhatsApp consent request. Rows are appended, never
 * changed: the account's state is its latest row (granted, withdrawn or declined), and the earlier
 * rows are the history that proves each choice. Separate from the terms' acceptances (D-55).
 */
@Schema({ collection: 'whatsappConsents', timestamps: true })
export class WhatsappConsentEntity {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  userId!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: WHATSAPP_ACTIONS })
  action!: WhatsappAction;

  @Prop({ required: true, type: String, enum: WHATSAPP_METHODS })
  method!: WhatsappMethod;

  /** The version of the consent text the person saw (WHATSAPP_CONSENT_TEXT_VERSION). */
  @Prop({ required: true, type: String })
  textVersion!: string;

  /** From the injected Clock (AR-24). */
  @Prop({ required: true, type: Date })
  at!: Date;
}

export type WhatsappConsentDocument = HydratedDocument<WhatsappConsentEntity>;

export const WhatsappConsentSchema = SchemaFactory.createForClass(WhatsappConsentEntity);

// AR-27: "the latest answer of this account". Built in production by migration
// 0008-consent-indexes (AR-29), whose unit spec holds it equal to this.
WhatsappConsentSchema.index({ userId: 1, at: -1 });

makeInsertOnly(WhatsappConsentSchema, 'whatsappConsents');

// AR-16: no owner path; the account's own record, written and read by the authenticated account's
// id (BR-002-11), never listed per owner or account. Inventoried in SECURITY.md §9 (SC-25).
markIsolation(WhatsappConsentSchema, {
  kind: 'internal',
  reason:
    "WhatsApp consent answers (SPEC-010 BR-010-27): insert-only history read by the authenticated account's own id, never listed per owner or account",
});
