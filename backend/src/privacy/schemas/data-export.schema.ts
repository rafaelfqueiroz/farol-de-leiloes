import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';
import {
  EXPORT_ERROR_CODES,
  EXPORT_STATUSES,
  type ExportErrorCode,
  type ExportStatus,
} from '../domain/data-export.js';

/**
 * SPEC-010 BR-010-08, BR-010-11: one request for a copy of the account's own data, and the file it
 * produced. The row holds ids, instants, a status and a random file key: no personal content (the
 * export itself lives in the private bucket, under a key that names nobody, SC-18, SC-15).
 */
@Schema({ collection: 'dataExports', timestamps: true })
export class DataExportEntity {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId })
  userId!: Types.ObjectId;

  /** From the injected Clock (AR-24). */
  @Prop({ required: true, type: Date })
  requestedAt!: Date;

  @Prop({ required: true, type: String, enum: EXPORT_STATUSES, default: 'queued' })
  status!: ExportStatus;

  /**
   * `true` while the export is queued or ready and absent otherwise: the partial unique index on it
   * is what makes one live export per account hold under any race (BR-010-11). MongoDB cannot
   * filter a partial index on a set of statuses, hence a flag the transitions out of
   * `queued`/`ready` unset in the same update that changes the status.
   */
  @Prop({ type: Boolean, required: false })
  live?: boolean;

  /**
   * `private/exports/<random>.json`: random, carrying no personal data (SC-18). Chosen when the
   * worker claims the export and BEFORE it writes the file, so a crash or a race never leaves a file
   * no row names: whoever finds a row that is no longer live with a key still set deletes that file.
   */
  @Prop({ type: String, required: false })
  fileKey?: string;

  @Prop({ type: Date, required: false })
  readyAt?: Date;

  /** `readyAt` + EXPORT_TTL_DAYS; the download is refused from this instant on (half-open). */
  @Prop({ type: Date, required: false })
  expiresAt?: Date;

  /** A stable code (`EXPORT_ERROR_CODES`), never a message (SC-15). */
  @Prop({ type: String, required: false, enum: EXPORT_ERROR_CODES })
  errorCode?: ExportErrorCode;

  /** The worker's claim while it builds the file: a random token and its expiry (a lease). */
  @Prop({ type: String, required: false })
  claimToken?: string;

  @Prop({ type: Date, required: false })
  claimUntil?: Date;
}

export type DataExportDocument = HydratedDocument<DataExportEntity>;

export const DataExportSchema = SchemaFactory.createForClass(DataExportEntity);

// AR-27 / AR-29: built in production by migration 0009-privacy-rights-indexes, whose unit spec holds
// them equal to these.
// One live (queued or ready) export per account, whatever races (BR-010-11).
DataExportSchema.index(
  { userId: 1 },
  { unique: true, name: 'one_live_export_per_user', partialFilterExpression: { live: true } },
);
// The account's own list, newest first.
DataExportSchema.index({ userId: 1, requestedAt: -1 });
// The worker's queue (oldest queued first) and the expiry job's scan.
DataExportSchema.index({ status: 1, requestedAt: 1 });
DataExportSchema.index({ status: 1, expiresAt: 1 });

// AR-16: no owner path. The account's own export request, created for and read by the authenticated
// account's id (BR-002-11), never listed per owner or account. Inventoried in SECURITY.md §9 (SC-25).
markIsolation(DataExportSchema, {
  kind: 'internal',
  reason:
    "Data export requests of an account (SPEC-010 BR-010-08, BR-010-11): created and read by the authenticated account's own id, never listed per owner or account",
});
