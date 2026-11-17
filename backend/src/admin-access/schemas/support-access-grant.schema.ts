import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';
import { GRANT_END_REASONS, type GrantEndReason } from '../domain/grant-validity.js';

export const GRANT_STATUSES = ['open', 'ended'] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

/**
 * SPEC-002 BR-002-24..BR-002-26 / DL-002-04: a support access grant, the admin's only path to
 * client data. One admin, one support request, one requester; read-only (BR-002-25), valid until
 * the request is closed, the permission withdrawn or 7 days pass (BR-002-26).
 *
 * A grant is never edited: it is inserted when opened, and its only change is the end transition
 * (`status: 'open' → 'ended'`, with `endedAt` and `endReason`), made once by a conditional update
 * (SupportAccessGrantRepository; test/structural/admin-access-append-only.spec.ts holds it).
 */
@Schema({ collection: 'supportAccessGrants', timestamps: true })
export class SupportAccessGrantEntity {
  /** SPEC-009's support request (BR-002-24). At most one grant per request is not ended. */
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  supportRequestId!: Types.ObjectId;

  /** The admin the grant was opened for; nobody else reads through it. */
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  adminUserId!: Types.ObjectId;

  /** The account that opened the request: whose view the grant shows (BR-002-25). */
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  requesterUserId!: Types.ObjectId;

  @Prop({ required: true, type: Date })
  openedAt!: Date;

  /** openedAt + 7 days (BR-002-26): the first instant the grant no longer covers. */
  @Prop({ required: true, type: Date })
  expiresAt!: Date;

  /**
   * 'open' until the end transition. Kept as a field (beside `endedAt`) so the unique index can be
   * partial on it: MongoDB's partial indexes cannot filter on a missing field.
   */
  @Prop({ required: true, type: String, enum: GRANT_STATUSES, default: 'open' })
  status!: GrantStatus;

  @Prop({ type: Date })
  endedAt?: Date;

  @Prop({ type: String, enum: GRANT_END_REASONS })
  endReason?: GrantEndReason;
}

export type SupportAccessGrantDocument = HydratedDocument<SupportAccessGrantEntity>;

export const SupportAccessGrantSchema = SchemaFactory.createForClass(SupportAccessGrantEntity);

// BR-002-24: one grant per support request that has not ended, so two concurrent opens end with
// one grant (the second insert fails with a duplicate key and reads the first). An ended grant
// leaves the index, so a request may get a new grant after its previous one expired.
SupportAccessGrantSchema.index(
  { supportRequestId: 1 },
  { unique: true, partialFilterExpression: { status: 'open' }, name: 'one_open_grant_per_request' },
);
// AR-27: SPEC-009's "my grants" list for an admin.
SupportAccessGrantSchema.index({ adminUserId: 1, openedAt: -1 });

// AR-16: no owner. The grant says which admin may read whose view; it is read by the admin-access
// service only — by its id together with the admin it belongs to, or by its support request — and
// never listed per owner or per account through a client API. Not client data itself; inventoried
// in SECURITY.md §9 (SC-25).
markIsolation(SupportAccessGrantSchema, {
  kind: 'internal',
  reason:
    'Support access grants (SPEC-002 BR-002-24): operations records read by the admin-access service by id with their admin, never listed per owner or account',
});
