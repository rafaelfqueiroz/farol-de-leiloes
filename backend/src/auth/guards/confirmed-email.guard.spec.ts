// BR-001-04: the guard that keeps an unconfirmed account out of the account features, and the list
// of controllers that carry it.
import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { AiController } from '../../ai/ai.controller.js';
import { AuctionsController } from '../../auctions/auctions.controller.js';
import { CouponsController } from '../../coupons/coupons.controller.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { FavoritesController } from '../../favorites/favorites.controller.js';
import { HealthController } from '../../health/health.controller.js';
import { PaymentsController } from '../../payments/payments.controller.js';
import { RemindersController } from '../../reminders/reminders.controller.js';
import { SavedFiltersController } from '../../saved-filters/saved-filters.controller.js';
import { SupportController } from '../../support/support.controller.js';
import { AuthController } from '../auth.controller.js';
import { Public, RequiresAccess } from '../decorators/public.decorator.js';
import type { AuthenticatedUser } from '../interfaces/auth.interface.js';
import { ConfirmedEmailGuard } from './confirmed-email.guard.js';

class Plain {
  route() {}
}
class PublicHandler {
  @Public()
  route() {}
}
@Public()
class PublicClass {
  route() {}
}
@Public()
class PublicClassWithRequirement {
  @RequiresAccess()
  route() {}
}

function contextFor(
  target: { new (): object },
  user: Partial<AuthenticatedUser> | undefined,
): ExecutionContext {
  const instance = new target() as { route(): void };
  return {
    getHandler: () => instance.route,
    getClass: () => target,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

const guard = new ConfirmedEmailGuard(new Reflector());

describe('ConfirmedEmailGuard', () => {
  it('lets a confirmed account through', () => {
    expect(guard.canActivate(contextFor(Plain, { emailVerified: true }))).toBe(true);
  });

  it('refuses an unconfirmed account with EMAIL_VERIFICATION_REQUIRED', () => {
    expect(() => guard.canActivate(contextFor(Plain, { emailVerified: false }))).toThrow(
      new DomainError('EMAIL_VERIFICATION_REQUIRED'),
    );
  });

  it('refuses when there is no authenticated user, instead of letting the request through', () => {
    expect(() => guard.canActivate(contextFor(Plain, undefined))).toThrow(
      new DomainError('UNAUTHENTICATED'),
    );
  });

  it.each([
    ['a public handler', PublicHandler],
    ['a public controller', PublicClass],
  ])('leaves %s public, signed in or not', (_label, target) => {
    expect(guard.canActivate(contextFor(target, undefined))).toBe(true);
    expect(guard.canActivate(contextFor(target, { emailVerified: false }))).toBe(true);
  });
});

describe('ConfirmedEmailGuard and SC-07', () => {
  it('checks a @Public() controller handler that carries an access requirement', () => {
    expect(() =>
      guard.canActivate(contextFor(PublicClassWithRequirement, { emailVerified: false })),
    ).toThrow(new DomainError('EMAIL_VERIFICATION_REQUIRED'));
    expect(() => guard.canActivate(contextFor(PublicClassWithRequirement, undefined))).toThrow(
      new DomainError('UNAUTHENTICATED'),
    );
  });
});

describe('BR-001-04: which controllers carry the guard', () => {
  const guardsOf = (controller: object) =>
    (Reflect.getMetadata('__guards__', controller) ?? []) as unknown[];

  it.each([
    ['favorites', FavoritesController],
    ['saved filters', SavedFiltersController],
    ['reminders', RemindersController],
    ['support', SupportController],
  ])('%s requires a confirmed email', (_label, controller) => {
    expect(guardsOf(controller)).toContain(ConfirmedEmailGuard);
  });

  it.each([
    ['auth (sign-in, confirmation, profile)', AuthController],
    ['auctions (public search)', AuctionsController],
    ['AI search', AiController],
    ['payments and plans', PaymentsController],
    ['coupons', CouponsController],
    ['health', HealthController],
  ])('%s does not', (_label, controller) => {
    expect(guardsOf(controller)).not.toContain(ConfirmedEmailGuard);
  });
});
