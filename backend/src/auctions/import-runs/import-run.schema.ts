import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';
import { IMPORT_OUTCOMES, type ImportCounts, type ImportOutcome } from './import-run.js';

/**
 * SPEC-004 BR-004-27: one row per Brasília day the import ran. Ids, counts, dates and outcome
 * codes only (SC-15): no row of the list, no address, no message. The unique `brasiliaDate` is
 * what makes a day's retries one run (BR-004-07).
 */
@Schema({ collection: 'importruns', timestamps: true })
export class ImportRunEntity {
  /** `YYYY-MM-DD`, a Brasília calendar day (AR-22). */
  @Prop({ required: true, type: String })
  brasiliaDate!: string;

  @Prop({ required: true, type: Date })
  startedAt!: Date;

  @Prop({ type: Date, default: null })
  finishedAt!: Date | null;

  @Prop({ required: true, type: String, enum: IMPORT_OUTCOMES })
  outcome!: ImportOutcome;

  /** The Brasília day the list was generated, `YYYY-MM-DD` (AR-22). Named for the spec's field. */
  @Prop({ type: String, default: null })
  listGeneratedAt!: string | null;

  @Prop({ type: Number, default: 0, min: 0 })
  listRows!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  attempts!: number;

  @Prop({
    type: { new: Number, changed: Number, unavailable: Number, active: Number },
    _id: false,
    default: () => ({ new: 0, changed: 0, unavailable: 0, active: 0 }),
  })
  counts!: ImportCounts;

  /**
   * Detail collection (part 3). Named `detailCollection` because `collection` is a reserved
   * Mongoose path (it is the document's own collection handle); the issue's `collection` object.
   */
  @Prop({
    type: { collected: Number, failed: Number, blocked: Boolean },
    _id: false,
    default: () => ({ collected: 0, failed: 0, blocked: false }),
  })
  detailCollection!: { collected: number; failed: number; blocked: boolean };

  /** Stable codes only (SC-15). */
  @Prop({ type: [String], default: [] })
  failureReasons!: string[];

  @Prop({ type: Date, default: null })
  alertedAt!: Date | null;

  @Prop({ type: Date, default: null })
  updateCompletedAt!: Date | null;

  /** Whether Caixa was reached through the configured proxy (part 3, ADR-003). */
  @Prop({ type: Boolean, default: false })
  viaProxy!: boolean;

  /** The attempt that holds the run, and until when (part 3's overlap guard). */
  @Prop({ type: String, default: null })
  leaseOwner!: string | null;

  @Prop({ type: Date, default: null })
  leaseExpiresAt!: Date | null;

  /** When the next attempt is due (part 3). */
  @Prop({ type: Date, default: null })
  nextAttemptAt!: Date | null;

  /**
   * What the run knows of its day (part 3): codes and flags only (SC-15). `applying` is true from
   * the moment a validated list starts to be applied until it ended: a process that died leaves it
   * true and the next tick resumes the apply (BR-004-07).
   */
  @Prop({
    type: {
      listReached: Boolean,
      applying: Boolean,
      applyFailed: Boolean,
      rejection: { type: { generatedOn: String, reason: String }, _id: false, default: null },
    },
    _id: false,
    default: () => ({ listReached: false, applying: false, applyFailed: false, rejection: null }),
  })
  progress!: {
    listReached: boolean;
    applying: boolean;
    applyFailed: boolean;
    rejection: { generatedOn: string | null; reason: string } | null;
  };

  /** NO_UPDATE only: `WEEKEND` or `HOLIDAY`, as decided when the day ended (BR-004-03). */
  @Prop({ type: String, enum: ['WEEKEND', 'HOLIDAY'], default: null })
  nonBusinessReason!: 'WEEKEND' | 'HOLIDAY' | null;
}

export type ImportRunDocument = HydratedDocument<ImportRunEntity>;

export const ImportRunSchema = SchemaFactory.createForClass(ImportRunEntity);

// AR-27 / AR-29: built in production by migration 0012-auction-import-model, whose unit spec holds
// them equal to these. One run per Brasília day, whatever races.
ImportRunSchema.index({ brasiliaDate: 1 }, { unique: true, name: 'one_run_per_brasilia_date' });
// The last SUCCESS run (the list the validator compares with, BR-004-02, BR-004-04).
ImportRunSchema.index({ outcome: 1, brasiliaDate: -1 });

markIsolation(ImportRunSchema, {
  kind: 'public',
  reason:
    'Import Run records (SPEC-004 BR-004-27): dates, counts and outcome codes of the Caixa import, no account or client data (SC-15); read by admins and the "last updated" display',
});
