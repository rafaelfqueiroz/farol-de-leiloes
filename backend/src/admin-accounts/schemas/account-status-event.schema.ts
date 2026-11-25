import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';
import { STATUS_ACTIONS, type StatusAction } from '../domain/account-status-change.js';

/**
 * SPEC-009 BR-009-16, BR-009-17: the history of an account's deactivations and reactivations, with the
 * admin, the time and the reason. INSERT-ONLY (AR-30): a history that can be edited is no history.
 * The repository exposes `append` and reads only, the update/delete query middleware below throws,
 * and test/structural/account-status-events-append-only.spec.ts fails on any update or delete call
 * against the model.
 *
 * Personal data (SC-25): `userId` and `adminUserId` are ids, and `reason` is FREE TEXT an admin typed
 * about a person. It is kept on purpose: "the history of its changes all stays" (BR-009-16) and the
 * period is the lawyer's (BR-010-23, Q-21), so the model is RETAINED (privacy/registry/retained-models.ts)
 * and inventoried in SECURITY.md §9. Nothing writes a name, an address or a phone into it by itself
 * and the admin's screen asks for a reason, not for personal details.
 */
@Schema({ collection: 'accountStatusEvents', timestamps: true })
export class AccountStatusEventEntity {
  /** The account the change was made to. */
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  userId!: Types.ObjectId;

  @Prop({ required: true, type: String, enum: STATUS_ACTIONS })
  action!: StatusAction;

  /** The admin who made it (BR-009-17). */
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  adminUserId!: Types.ObjectId;

  /** BR-009-15: the reason, required for a deactivation; BR-009-17: an optional note for a reactivation. */
  @Prop({ type: String, default: '' })
  reason!: string;

  /** When the change was made, from the injected Clock (AR-24). */
  @Prop({ required: true, type: Date })
  at!: Date;
}

export type AccountStatusEventDocument = HydratedDocument<AccountStatusEventEntity>;

export const AccountStatusEventSchema = SchemaFactory.createForClass(AccountStatusEventEntity);

// AR-27: "the history of this account, newest first". Built in production by migration
// 0013-account-status-events-indexes (AR-29), whose unit spec holds them equal.
AccountStatusEventSchema.index({ userId: 1, at: -1 });

/** AR-30: the operations that would edit or delete an entry. All refused. */
export const ACCOUNT_STATUS_EVENT_FORBIDDEN_QUERIES = [
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
  throw new Error('accountStatusEvents is append-only (SPEC-009 BR-009-17, AR-30)');
};
AccountStatusEventSchema.pre([...ACCOUNT_STATUS_EVENT_FORBIDDEN_QUERIES], appendOnly);
AccountStatusEventSchema.pre('bulkWrite', appendOnly);
AccountStatusEventSchema.pre('save', function (this: AccountStatusEventDocument) {
  if (!this.isNew) appendOnly();
});

// AR-16: no owner path and not an account's own data: the platform's accountability record of what an
// admin did to an account, written by the admin accounts service and read by the same admin's record
// view; the account it names never lists it (it is not "my data"). Inventoried in SECURITY.md §9.
markIsolation(AccountStatusEventSchema, {
  kind: 'internal',
  reason:
    'Account status history (SPEC-009 BR-009-17): insert-only record of an admin deactivating or reactivating an account, written by the admin accounts service and read only on the admin account record, never listed through an account’s own routes',
});
