// SPEC-010 BR-010-25, BR-010-26: whether the lawyer's validation of a scope is recorded and still
// counts. The decision is the pure domain/legal-validation.ts; this service reads the records, the
// document versions in force (LegalDocumentsService, which owns the Clock, AR-24) and the retention
// setting (AR-43). Read only: the validations are written by `npm run legal:record-validation`.
import { Inject, Injectable } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import businessConfig from '../../config/business.config.js';
import {
  evaluateGate,
  LEGAL_VALIDATION_SCOPES,
  type LegalValidationScope,
  type ValidationState,
} from '../domain/legal-validation.js';
import { LegalDocumentsService } from '../legal-documents.service.js';
import { LegalValidationsRepository } from './legal-validations.repository.js';

/** What the checklist shows of one gate: no validator, no reference (SC-15). */
export interface GateStatus {
  readonly scope: LegalValidationScope;
  readonly validated: boolean;
  readonly validatedAt: Date | null;
  readonly documentVersions: readonly string[] | null;
}

@Injectable()
export class LegalValidationService {
  constructor(
    private readonly validations: LegalValidationsRepository,
    private readonly documents: LegalDocumentsService,
    @Inject(businessConfig.KEY) private readonly config: ConfigType<typeof businessConfig>,
  ) {}

  /** Whether the validation of `scope` is recorded and still counts now. Throws if it cannot tell. */
  async isValidated(scope: LegalValidationScope): Promise<boolean> {
    return (await this.status(scope)).validated;
  }

  async status(scope: LegalValidationScope): Promise<GateStatus> {
    const records = await this.validations.newestOfScope(scope);
    const decision = evaluateGate(scope, records, this.state());
    return {
      scope,
      validated: decision.validated,
      validatedAt: decision.record?.validatedAt ?? null,
      documentVersions: decision.record?.documentVersions ?? null,
    };
  }

  /** Every gate, in the order of BR-010-26's catalogue. */
  async statusOfAll(): Promise<GateStatus[]> {
    return Promise.all(LEGAL_VALIDATION_SCOPES.map((scope) => this.status(scope)));
  }

  /** The versions in force now and the period set now: what a recorded review is compared with. */
  private state(): ValidationState {
    return {
      currentVersions: this.documents.currentVersions(),
      retentionYears: this.config.privacy.documentRetentionYears,
    };
  }
}
