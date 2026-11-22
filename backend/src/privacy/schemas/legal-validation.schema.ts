import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';
import { LEGAL_VALIDATION_SCOPES, type LegalValidationScope } from '../domain/legal-validation.js';
import { makeInsertOnly } from './insert-only.js';

/**
 * SPEC-010 BR-010-26: one recorded validation by a lawyer: the scope, the date, the validator and the
 * document versions reviewed. Insert-only (AR-30): a validation is evidence, a later one supersedes
 * it. Written ONLY by `npm run legal:record-validation` (no HTTP endpoint writes it, BR-010-25).
 */
@Schema({ collection: 'legalValidations', timestamps: true })
export class LegalValidationEntity {
  @Prop({ required: true, type: String, enum: LEGAL_VALIDATION_SCOPES })
  scope!: LegalValidationScope;

  /** From the injected Clock (AR-24): when the validation was recorded. */
  @Prop({ required: true, type: Date })
  validatedAt!: Date;

  /** The lawyer's or firm's name as the owner typed it. Never logged, never in an API response. */
  @Prop({ required: true, type: String })
  validatorName!: string;

  /** `terms:1.0`, `privacy:1.0`: the texts reviewed. */
  @Prop({ required: true, type: [String], default: [] })
  documentVersions!: string[];

  /** An identifier of the opinion (a number, a date, a file name). Optional. */
  @Prop({ required: false, type: String })
  reference?: string;

  /** The DOCUMENT_RETENTION_YEARS the lawyer reviewed (scope retention-periods). */
  @Prop({ required: false, type: Number })
  retentionYears?: number;
}

export type LegalValidationDocument = HydratedDocument<LegalValidationEntity>;

export const LegalValidationSchema = SchemaFactory.createForClass(LegalValidationEntity);

// AR-27 / AR-29: the gate reads the newest records of one scope. Built in production by migration
// 0010-retention-legal-indexes, whose unit spec holds it equal to this one.
LegalValidationSchema.index({ scope: 1, validatedAt: -1 });

makeInsertOnly(LegalValidationSchema, 'legalValidations');

// AR-16: no owner and no account path. A validation belongs to the platform, not to anyone's data.
markIsolation(LegalValidationSchema, {
  kind: 'internal',
  reason:
    "Lawyer's validations of the legal documents, the retention periods and the processing of third parties' data (SPEC-010 BR-010-26): platform records written by an operator script, read by the legal gate and the launch checklist, never per owner or account",
});
