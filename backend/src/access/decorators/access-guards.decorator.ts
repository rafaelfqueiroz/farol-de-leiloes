// SPEC-002 BR-002-10: the opt-in access checks of a route. Each decorator records what the route
// needs, applies its guard and documents the 403 in the OpenAPI document (AR-33). They run after
// the global JwtAuthGuard and AccessContextGuard, so the request already carries its context.
//
// SC-07: each also sets REQUIRES_ACCESS, which overrides @Public() at any level (isPublicRoute): the
// route authenticates even inside a @Public() controller, and the guard never lets an anonymous
// request through. test/structural/public-access-decorators.spec.ts rejects mixing the two on one
// handler or controller, or a @Public() handler in a controller that carries a requirement.
import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';
import { RequiresAccess } from '../../auth/decorators/public.decorator.js';
import { ErrorResponseDto } from '../../common/errors/error-response.dto.js';
import type { Persona } from '../domain/personas.js';
import { AdminGuard } from '../guards/admin.guard.js';
import {
  type EntitlementRequirement,
  EntitlementGuard,
  REQUIRED_ENTITLEMENT,
} from '../guards/entitlement.guard.js';
import { PersonaGuard, REQUIRED_PERSONAS } from '../guards/persona.guard.js';

/** BR-002-14: the route needs any of these personas. */
export function RequiresPersona(...personas: [Persona, ...Persona[]]) {
  return applyDecorators(
    RequiresAccess(),
    SetMetadata(REQUIRED_PERSONAS, personas),
    UseGuards(PersonaGuard),
    ApiForbiddenResponse({
      description: `PERSONA_REQUIRED: needs one of ${personas.join(', ')} (BR-002-14)`,
      type: ErrorResponseDto,
    }),
  );
}

/** BR-002-13 / BR-002-30: the route needs a plan entitlement; `write` refuses read-only offices. */
export function RequiresEntitlement(entitlement: string, options: { write?: boolean } = {}) {
  const requirement: EntitlementRequirement = { entitlement, write: options.write === true };
  return applyDecorators(
    RequiresAccess(),
    SetMetadata(REQUIRED_ENTITLEMENT, requirement),
    UseGuards(EntitlementGuard),
    ApiForbiddenResponse({
      description: requirement.write
        ? `PLAN_NOT_ALLOWED without "${entitlement}"; OFFICE_READ_ONLY when the office is read-only (BR-002-30)`
        : `PLAN_NOT_ALLOWED without "${entitlement}" (BR-002-13)`,
      type: ErrorResponseDto,
    }),
  );
}

/**
 * BR-002-23: platform operation only; `users.isAdmin`, never the plan tier, and a confirmed email
 * (SC-09, BR-001-04).
 */
export function AdminOnly() {
  return applyDecorators(
    RequiresAccess(),
    UseGuards(AdminGuard),
    ApiForbiddenResponse({
      description:
        'FORBIDDEN: admin capability only (BR-002-23); EMAIL_VERIFICATION_REQUIRED: an admin ' +
        'whose email is not confirmed (SC-09, BR-001-04)',
      type: ErrorResponseDto,
    }),
  );
}
