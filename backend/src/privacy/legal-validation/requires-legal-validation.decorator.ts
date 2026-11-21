// SPEC-010 BR-010-25 (DL-010-07): the opt-in gate of the features that handle third parties' data for
// legal analysis (SPEC-015, SPEC-024). `@RequiresLegalValidation('third-party-processing')` on a
// handler or a controller refuses the request with 403 LEGAL_VALIDATION_REQUIRED while the gate is
// enforced and no validation counts. The module that holds the route imports LegalValidationModule
// (the guard it applies needs its service).
//
// SC-07: like the SPEC-002 access decorators it sets REQUIRES_ACCESS, which overrides @Public() at any
// level, so a misplaced @Public() can never open a gated route; the structural scan
// (test/structural/public-access-decorators.spec.ts) lists it among the access decorators.
import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import { RequiresAccess } from '../../auth/decorators/public.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { LegalValidationScope } from '../domain/legal-validation.js';
import { LegalValidationGuard, REQUIRED_LEGAL_VALIDATION } from './legal-validation.guard.js';

export function RequiresLegalValidation(scope: LegalValidationScope) {
  return applyDecorators(
    RequiresAccess(),
    SetMetadata(REQUIRED_LEGAL_VALIDATION, scope),
    UseGuards(LegalValidationGuard),
    ApiForbiddenResponse({
      description:
        `LEGAL_VALIDATION_REQUIRED: the lawyer's validation of "${scope}" is not recorded and the ` +
        'gate is enforced (production-like environments, BR-010-25)',
      type: ErrorResponseDto,
    }),
  );
}
