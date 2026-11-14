import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator.js';
import { DomainError } from '../../common/errors/domain-error.js';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles) {
      return true;
    }

    const { user } = context.switchToHttp().getRequest();

    if (!user || !user.role) {
      throw new DomainError('FORBIDDEN');
    }

    if (user.role === 'admin') {
      return true;
    }

    const hasRole = requiredRoles.some((role) => user.role === role);
    if (!hasRole) {
      throw new DomainError('PLAN_NOT_ALLOWED', { requiredRoles });
    }

    return true;
  }
}
