// SPEC-010 BR-010-26: the script's use case over the legal registry, the Clock and the insert-only
// repository. The rules are the pure record-validation.ts.
import { Inject, Injectable } from '@nestjs/common';
import { Clock } from '../../../common/clock/clock.js';
import type { PublishedLegalDocument } from '../../legal/legal-document.js';
import { LEGAL_DOCUMENTS } from '../../legal/registry.js';
import { LegalValidationsRepository } from '../legal-validations.repository.js';
import {
  planValidation,
  type RecordValidationInput,
  type RecordValidationOutcome,
} from './record-validation.js';

@Injectable()
export class RecordValidationCommand {
  constructor(
    private readonly validations: LegalValidationsRepository,
    private readonly clock: Clock, // AR-24: validatedAt is the instant it is recorded
    @Inject(LEGAL_DOCUMENTS) private readonly registry: readonly PublishedLegalDocument[],
  ) {}

  async run(input: RecordValidationInput): Promise<RecordValidationOutcome> {
    const plan = planValidation(input, this.registry);
    if (!plan.ok) return { result: 'refused', reason: plan.reason };
    await this.validations.insert({
      scope: plan.scope,
      validatedAt: this.clock.now(),
      validatorName: plan.validatorName,
      documentVersions: plan.documentVersions,
      ...(plan.reference !== undefined ? { reference: plan.reference } : {}),
      ...(plan.retentionYears !== undefined ? { retentionYears: plan.retentionYears } : {}),
    });
    return { result: 'recorded', scope: plan.scope, documentVersions: plan.documentVersions };
  }
}
