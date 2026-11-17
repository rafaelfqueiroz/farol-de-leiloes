import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';

export const ADMIN_ACCESS_ACTIONS = ['grant_read', 'account_search', 'account_view'] as const;
export type AdminAccessAction = (typeof ADMIN_ACCESS_ACTIONS)[number];

export const LOGGED_OWNER_TYPES = ['office', 'self_advised', 'account'] as const;
export type LoggedOwnerType = (typeof LOGGED_OWNER_TYPES)[number];

/** Whose data was read: an office, a self-advised investor, or an account's own data. */
export interface LoggedOwner {
  type: LoggedOwnerType;
  id: Types.ObjectId;
}

/** Which record was read: its kind (a collection-level name such as 'journey') and its id. */
export interface LoggedResource {
  type: string;
  id: Types.ObjectId;
}

// `type` is a path name here, hence the `{ type: { type: String } }` spelling (Mongoose's typeKey).
const LoggedOwnerSchema = new MongooseSchema<LoggedOwner>(
  {
    type: { type: String, enum: LOGGED_OWNER_TYPES, required: true },
    id: { type: MongooseSchema.Types.ObjectId, required: true },
  },
  { _id: false },
);

const LoggedResourceSchema = new MongooseSchema<LoggedResource>(
  {
    type: { type: String, required: true },
    id: { type: MongooseSchema.Types.ObjectId, required: true },
  },
  { _id: false },
);

/**
 * SPEC-002 BR-002-27 / AR-30: the admin access log. One entry per record an admin read under a
 * support access grant (`grant_read`), and, from SPEC-009, per account search or account view.
 *
 * INSERT-ONLY. No product action edits or deletes an entry, the admin's included: the repository
 * exposes `append` only, the update/delete query middleware below throws, and
 * test/structural/admin-access-append-only.spec.ts fails on any update or delete call against it.
 * Retention is lawyer-set (SECURITY.md §9, BR-010-23); its purge job will be the one reviewed
 * exception, with SPEC-010.
 */
@Schema({ collection: 'adminAccessLogs', timestamps: true })
export class AdminAccessLogEntity {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  adminUserId!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: ADMIN_ACCESS_ACTIONS })
  action!: AdminAccessAction;

  /** `grant_read`: the grant the read went through. */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  grantId?: Types.ObjectId;

  /** `grant_read`: the support request the grant hangs on (BR-002-27). */
  @Prop({ type: MongooseSchema.Types.ObjectId })
  supportRequestId?: Types.ObjectId;

  @Prop({ type: LoggedOwnerSchema })
  owner?: LoggedOwner;

  @Prop({ type: LoggedResourceSchema })
  resource?: LoggedResource;

  /**
   * `account_search` only (SPEC-009): what the admin searched for. SC-15 / SC-25: SPEC-009 must
   * not put personal data in it (an email or a name typed in the search), or must justify it in
   * the LGPD inventory (SECURITY.md §9) before it does. Nothing writes it yet.
   */
  @Prop({ type: String })
  query?: string;

  /** When the read happened, from the injected Clock (AR-24). */
  @Prop({ required: true, type: Date })
  at!: Date;
}

export type AdminAccessLogDocument = HydratedDocument<AdminAccessLogEntity>;

export const AdminAccessLogSchema = SchemaFactory.createForClass(AdminAccessLogEntity);

// AR-27: SPEC-009's "what did this admin read" and SPEC-010's "who read this owner's data".
AdminAccessLogSchema.index({ adminUserId: 1, at: -1 });
AdminAccessLogSchema.index({ 'owner.id': 1, at: -1 });

/** BR-002-27: the operations that would edit or delete an entry. All refused. */
export const ADMIN_ACCESS_LOG_FORBIDDEN_QUERIES = [
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'replaceOne',
  'deleteOne',
  'deleteMany',
] as const;

const appendOnly = (): never => {
  throw new Error('adminAccessLogs is append-only (SPEC-002 BR-002-27, AR-30)');
};
// Defence in depth behind the repository: even code that reached the model could not change an
// entry through Mongoose (the structural test is the first line).
AdminAccessLogSchema.pre([...ADMIN_ACCESS_LOG_FORBIDDEN_QUERIES], appendOnly);
AdminAccessLogSchema.pre('bulkWrite', appendOnly);
AdminAccessLogSchema.pre('save', function (this: AdminAccessLogDocument) {
  if (!this.isNew) appendOnly();
});

// AR-16: no owner path. The log is the platform's accountability record of admin reads (BR-002-27):
// written by the admin-access service, read by operations and data-rights features (SPEC-009,
// SPEC-010), never listed through a client API. `owner.id` names whose data was read; it is not an
// owner scope. Inventoried in SECURITY.md §9 (SC-25).
markIsolation(AdminAccessLogSchema, {
  kind: 'internal',
  reason:
    'Admin access log (SPEC-002 BR-002-27): insert-only accountability record of admin reads, written by the admin-access service, never listed per owner or account through a client API',
});
