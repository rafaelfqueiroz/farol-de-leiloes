// SPEC-010 BR-010-25: a probe controller gated with @RequiresLegalValidation, standing in for the real
// consumers (SPEC-015 manual legal analysis, SPEC-024 AI document analysis), which do not exist yet.
// Used only by the specs; never part of the API. A module with a gated route imports
// LegalValidationModule, as the real ones will.
import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '../../src/auth/decorators/public.decorator.js';
import { LegalValidationModule } from '../../src/privacy/legal-validation/legal-validation.module.js';
import { RequiresLegalValidation } from '../../src/privacy/legal-validation/requires-legal-validation.decorator.js';

@Controller('legal-gate-probe')
export class LegalGateProbeController {
  @Get('third-party')
  @RequiresLegalValidation('third-party-processing')
  thirdParty() {
    return { ok: true };
  }

  @Get('terms')
  @RequiresLegalValidation('terms')
  terms() {
    return { ok: true };
  }

  @Get('open')
  open() {
    return { ok: true };
  }
}

/** A controller that is @Public() as a whole; its one gated handler must still authenticate and gate. */
@Public()
@Controller('legal-gate-public-probe')
export class LegalGatePublicProbeController {
  @Get('open')
  open() {
    return { ok: true };
  }

  @Get('gated')
  @RequiresLegalValidation('third-party-processing')
  gated() {
    return { ok: true };
  }
}

@Module({
  imports: [LegalValidationModule],
  controllers: [LegalGateProbeController, LegalGatePublicProbeController],
})
export class LegalGateProbeModule {}
