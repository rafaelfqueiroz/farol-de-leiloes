import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';
import { SUPPORT_REQUEST_STATUSES, type SupportRequestStatus } from '../domain/support-request.js';

/**
 * SPEC-009 BR-009-06, BR-009-07, BR-009-08, BR-009-12: one support request, and the state of the two
 * emails it owes (the outbox: the confirmation to the requester and the notice to the support team).
 *
 * It holds the requester's own words (`subject`, `message`: free text, personal data, SC-15: never
 * logged) and NO copy of the requester's name or email: both are read from the account at send time,
 * so a confirmation goes to the CURRENT address (BR-009-07). The outbox fields hold instants, counts
 * and a random claim token only.
 */
@Schema({ collection: 'supportRequests', timestamps: true })
export class SupportRequestEntity {
  /** The requester: the account that opened it. Set by the repository from the session (BR-002-11). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'UserEntity', required: true })
  userId!: Types.ObjectId;

  /** `FL-YYYY-NNNNNN`, unique across the platform (BR-009-06, domain/protocol.ts). */
  @Prop({ type: String, required: true })
  protocol!: string;

  @Prop({ type: String, required: true })
  subject!: string;

  @Prop({ type: String, required: true })
  message!: string;

  /** The option of the form, unticked by default (BR-009-08). Never changed after creation. */
  @Prop({ type: Boolean, required: true, default: false })
  allowDataAccess!: boolean;

  /** When the requester withdrew the permission (BR-009-08); it ends any grant at once. */
  @Prop({ type: Date, required: false })
  dataAccessWithdrawnAt?: Date;

  @Prop({ type: String, enum: SUPPORT_REQUEST_STATUSES, required: true, default: 'open' })
  status!: SupportRequestStatus;

  /** BR-009-12 (set by the admin's close route, SPEC-009 part 2). */
  @Prop({ type: Date, required: false })
  closedAt?: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: false })
  closedBy?: Types.ObjectId;

  // --- The outbox (BR-009-07): each mail is delivered once, retried with a growing delay. ---

  @Prop({ type: Date, required: false })
  confirmationSentAt?: Date;

  /** The confirmation was not sent on purpose: the account was not active at delivery time. */
  @Prop({ type: Date, required: false })
  confirmationSkippedAt?: Date;

  @Prop({ type: Date, required: false })
  teamNoticeSentAt?: Date;

  @Prop({ type: Date, required: false })
  teamNoticeSkippedAt?: Date;

  /** Failed delivery rounds so far (domain/mail-outbox.ts: the delay grows, then it gives up). */
  @Prop({ type: Number, required: true, default: 0 })
  mailAttempts!: number;

  /**
   * When the next delivery round is due. Present while an email is owed; REMOVED once nothing is
   * owed or the retries gave up, which is what keeps the partial index below small.
   */
  @Prop({ type: Date, required: false })
  mailNextAttemptAt?: Date;

  /** The claim of the delivery in progress: a random token and its lease's end (at most one sender). */
  @Prop({ type: String, required: false })
  mailClaimToken?: string;

  @Prop({ type: Date, required: false })
  mailClaimUntil?: Date;

  @Prop({ type: Date, required: false })
  mailGaveUpAt?: Date;
}

export type SupportRequestDocument = HydratedDocument<SupportRequestEntity>;

export const SupportRequestSchema = SchemaFactory.createForClass(SupportRequestEntity);

// AR-27 / AR-29: built in production by migration 0012-support-requests-indexes, whose unit spec holds
// them equal to these.
// BR-009-06: the protocol is unique across the platform, whatever races.
SupportRequestSchema.index({ protocol: 1 }, { unique: true });
// BR-009-09: the requester's own list, newest first.
SupportRequestSchema.index({ userId: 1, createdAt: -1 });
// BR-009-12: the admin's queue by status (SPEC-009 part 2).
SupportRequestSchema.index({ status: 1, createdAt: -1 });
// BR-009-07: the outbox worker's scan of what is due; only rows that still owe an email carry the field.
SupportRequestSchema.index(
  { mailNextAttemptAt: 1 },
  { partialFilterExpression: { mailNextAttemptAt: { $exists: true } } },
);

// AR-16 / TS-14: the account's own data (BR-002-02), scoped by userId; the requester sees only their
// requests. The admin's side (by id, the queue, the outbox) uses the named across-accounts methods.
markIsolation(SupportRequestSchema, {
  kind: 'account',
  reason:
    "SPEC-009 BR-009-09: the requester's own support requests, scoped by userId (SupportRequestsRepository); an admin reaches one only through the named across-accounts methods and a support access grant",
});
