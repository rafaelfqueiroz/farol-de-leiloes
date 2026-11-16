import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../common/errors/domain-error.js';
import type { Persona } from '../domain/personas.js';
import { accessContextOf, type RequestWithAccess } from '../decorators/access.decorator.js';
import { isPublicRoute } from './public-route.js';

export const REQUIRED_PERSONAS = 'access:required-personas';

/**
 * SPEC-002 BR-002-10 / BR-002-14: the route needs ANY of the personas listed with
 * @RequiresPersona(), derived from the account's current relationships (never a stored role).
 * Refused with PERSONA_REQUIRED (403): no record is involved, so nothing leaks (AR-14 is about
 * records, which answer 404).
 */
@Injectable()
export class PersonaGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublicRoute(this.reflector, context)) return true;
    const access = accessContextOf(context.switchToHttp().getRequest<RequestWithAccess>());
    const personas = this.reflector.getAllAndOverride<Persona[] | undefined>(REQUIRED_PERSONAS, [
      context.getHandler(),
      context.getClass(),
    ]);
    // Deny by default (SC-07): the guard used without its decorator lets nobody through.
    if (!personas || personas.length === 0) throw new DomainError('FORBIDDEN');
    if (!personas.some((persona) => access.hasPersona(persona))) {
      throw new DomainError('PERSONA_REQUIRED', { personas });
    }
    return true;
  }
}
