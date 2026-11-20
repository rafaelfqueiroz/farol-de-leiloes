import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';
import {
  ACCEPTANCE_METHODS,
  type AcceptanceMethod,
  LEGAL_DOCUMENT_TYPES,
  type LegalDocumentType,
} from '../domain/legal-versions.js';
import { makeInsertOnly } from './insert-only.js';

/**
 * SPEC-010 BR-010-03: one acceptance of one version of one legal document by one account. A row is
 * inserted once and never changed or deleted (insert-only, AR-30); the unique index below makes a
 * repeat, or two accepts at the same moment, end with one row.
 */
@Schema({ collection: 'consents', timestamps: true })
export class ConsentEntity {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  userId!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: LEGAL_DOCUMENT_TYPES })
  documentType!: LegalDocumentType;

  @Prop({ required: true, type: String })
  version!: string;

  /** sha256 of the exact text accepted (legal/legal-document.ts): proof of what was shown. */
  @Prop({ required: true, type: String })
  contentHash!: string;

  /** From the injected Clock (AR-24). */
  @Prop({ required: true, type: Date })
  acceptedAt!: Date;

  @Prop({ required: true, type: String, enum: ACCEPTANCE_METHODS })
  method!: AcceptanceMethod;

  /**
   * The account's `users.consentResetAt` when the row was written; null when it was never reset.
   * Only rows of the account's CURRENT value count (DL-001-02): what the registrant of an address
   * accepted before the real owner took the account over is not the owner's acceptance. It is part
   * of the unique key so the owner can accept a version the registrant had already accepted.
   */
  @Prop({ type: Date, default: null })
  consentResetAt!: Date | null;
}

export type ConsentDocument = HydratedDocument<ConsentEntity>;

export const ConsentSchema = SchemaFactory.createForClass(ConsentEntity);

// BR-010-03: one acceptance per account, consent generation, document and version. Also serves the terms guard's one
// query per request (AR-27) and the account's own list. Built in production by migration
// 0008-consent-indexes (AR-29), whose unit spec holds it equal to this.
ConsentSchema.index(
  { userId: 1, consentResetAt: 1, documentType: 1, version: 1 },
  { unique: true, name: 'one_acceptance_per_version' },
);

makeInsertOnly(ConsentSchema, 'consents');

// AR-16: no owner path. An acceptance is the account's own record: written by the sign-up and the
// accept route for the authenticated account's id, read by that same id (the account's acceptance
// list, the terms guard), never listed per owner or per account through a client API. Inventoried in
// SECURITY.md §9 (SC-25).
markIsolation(ConsentSchema, {
  kind: 'internal',
  reason:
    "Acceptances of the terms and the privacy policy (SPEC-010 BR-010-03): insert-only proof read by the authenticated account's own id, never listed per owner or account",
});
