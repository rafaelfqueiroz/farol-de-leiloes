// SPEC-002 BR-002-10: the opt-in access checks of a route. Each decorator records what the route
// needs, applies its guard and documents the 403 in the OpenAPI document (AR-33). They run after
// the global JwtAuthGuard and AccessContextGuard, so the request already carries its context.
import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiForbiddenResponse } from '@nestjs/swagger';
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

/** BR-002-23: platform operation only; `users.isAdmin`, never the plan tier. */
export function AdminOnly() {
  return applyDecorators(
    UseGuards(AdminGuard),
    ApiForbiddenResponse({
      description: 'FORBIDDEN: admin capability only (BR-002-23)',
      type: ErrorResponseDto,
    }),
  );
}
