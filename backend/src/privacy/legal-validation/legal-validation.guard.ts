import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../common/errors/domain-error.js';
import { jobErrorCode } from '../../common/services/job-error-code.js';
import { type Env, legalGateEnforced } from '../../config/env.js';
import type { LegalValidationScope } from '../domain/legal-validation.js';
import { LegalValidationService } from './legal-validation.service.js';

export const REQUIRED_LEGAL_VALIDATION = 'privacy:required-legal-validation';

/**
 * SPEC-010 BR-010-25: refuses a route marked `@RequiresLegalValidation(scope)` with 403
 * LEGAL_VALIDATION_REQUIRED `{ scope }` (a scope name and nothing else, AR-40) while the gate is
 * enforced (`LEGAL_GATE_ENFORCED`; unset: true in production, false elsewhere) and no validation of
 * the scope counts. Not enforced, it answers at once and reads nothing.
 *
 * It FAILS CLOSED: when the validation cannot be read (the database is down) the request is refused
 * as not validated, never let through. Applied by the decorator, after the global JwtAuthGuard (the
 * decorator also sets REQUIRES_ACCESS, SC-07), so it never runs for an anonymous request. Every
 * request reads the records (one indexed query, AR-27): a validation recorded a second ago counts on
 * the next request (AR-13, no cache).
 */
@Injectable()
export class LegalValidationGuard implements CanActivate {
  private readonly logger = new Logger(LegalValidationGuard.name);
  private readonly enforced: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly validation: LegalValidationService,
    config: ConfigService<Env, true>,
  ) {
    this.enforced = legalGateEnforced({
      NODE_ENV: config.get('NODE_ENV', { infer: true }),
      LEGAL_GATE_ENFORCED: config.get('LEGAL_GATE_ENFORCED', { infer: true }),
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.enforced) return true;
    const scope = this.reflector.getAllAndOverride<LegalValidationScope | undefined>(
      REQUIRED_LEGAL_VALIDATION,
      [context.getHandler(), context.getClass()],
    );
    // Applied without its decorator: a programming error, never a reason to open the route.
    if (scope === undefined) throw new Error('LegalValidationGuard is used without a scope');
    let validated = false;
    try {
      validated = await this.validation.isValidated(scope);
    } catch (error) {
      // Fail closed. The code only, never the driver's message (SC-15).
      this.logger.warn(`The legal validation could not be read; refusing: ${jobErrorCode(error)}`);
    }
    if (!validated) throw new DomainError('LEGAL_VALIDATION_REQUIRED', { scope });
    return true;
  }
}
