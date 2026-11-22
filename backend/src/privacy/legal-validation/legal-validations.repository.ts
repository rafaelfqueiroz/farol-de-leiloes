// SPEC-010 BR-010-26 / AR-08 / AR-30: the only file that touches the `legalValidations` model. It
// inserts and reads; it has no update and no delete (insert-only, held by
// test/structural/privacy-insert-only.spec.ts). Nothing here is reachable from an HTTP route.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import type { LegalValidationScope, ValidationRecord } from '../domain/legal-validation.js';
import {
  type LegalValidationDocument,
  LegalValidationEntity,
} from '../schemas/legal-validation.schema.js';

/** The newest records the gate looks at per scope: far more than a lawyer ever signs. */
export const VALIDATIONS_READ_LIMIT = 100;

export interface NewLegalValidation {
  readonly scope: LegalValidationScope;
  readonly validatedAt: Date;
  readonly validatorName: string;
  readonly documentVersions: readonly string[];
  readonly reference?: string;
  readonly retentionYears?: number;
}

@Injectable()
export class LegalValidationsRepository {
  constructor(
    @InjectModel(LegalValidationEntity.name)
    private readonly model: Model<LegalValidationDocument>,
  ) {}

  async insert(entry: NewLegalValidation): Promise<void> {
    await this.model.create({ ...entry, documentVersions: [...entry.documentVersions] });
  }

  /**
   * The newest records of one scope, newest first. The validator's name and the reference are not
   * selected: the gate and the checklist have no use for them and must not be able to leak them.
   */
  async newestOfScope(scope: LegalValidationScope): Promise<ValidationRecord[]> {
    const rows = await this.model
      .find({ scope: { $eq: scope } })
      .select('scope validatedAt documentVersions retentionYears')
      .sort({ validatedAt: -1, _id: -1 })
      .limit(VALIDATIONS_READ_LIMIT)
      .lean()
      .exec();
    return rows.map((row) => ({
      scope: row.scope,
      validatedAt: row.validatedAt,
      documentVersions: row.documentVersions,
      retentionYears: row.retentionYears ?? null,
    }));
  }
}
