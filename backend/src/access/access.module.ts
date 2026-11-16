import { Global, Module } from '@nestjs/common';
import { AccessContextFactory } from './access-context.js';
import { AccessContextGuard } from './guards/access-context.guard.js';
import { AdminGuard } from './guards/admin.guard.js';
import { EntitlementGuard } from './guards/entitlement.guard.js';
import { PersonaGuard } from './guards/persona.guard.js';
import { CLIENT_LINK_SOURCE, NoClientLinkSource } from './sources/client-link.source.js';
import { MEMBERSHIP_SOURCE, NoMembershipSource } from './sources/membership.source.js';
import { NoOfficePlanSource, OFFICE_PLAN_SOURCE } from './sources/office-plan.source.js';
import { NoSelfAdvisedSource, SELF_ADVISED_SOURCE } from './sources/self-advised.source.js';

/**
 * SPEC-002: the access context and the guards that read it (ARCHITECTURE §4).
 *
 * The four sources are the plug points of the specs that own the relationships. Each binding here
 * is a default that grants nothing; the owning spec replaces it with its own implementation:
 *
 *   MEMBERSHIP_SOURCE    SPEC-011 current office memberships
 *   CLIENT_LINK_SOURCE   SPEC-011 active/ended client links; SPEC-016 journeys as investor
 *   SELF_ADVISED_SOURCE  SPEC-011 self-advised status
 *   OFFICE_PLAN_SOURCE   SPEC-012 advisor plan, read-only state and entitlements
 *
 * AccessContextGuard is registered as a global guard by AuthModule, right after JwtAuthGuard.
 */
@Global()
@Module({
  providers: [
    AccessContextFactory,
    AccessContextGuard,
    PersonaGuard,
    EntitlementGuard,
    AdminGuard,
    { provide: MEMBERSHIP_SOURCE, useClass: NoMembershipSource },
    { provide: CLIENT_LINK_SOURCE, useClass: NoClientLinkSource },
    { provide: SELF_ADVISED_SOURCE, useClass: NoSelfAdvisedSource },
    { provide: OFFICE_PLAN_SOURCE, useClass: NoOfficePlanSource },
  ],
  exports: [
    AccessContextFactory,
    AccessContextGuard,
    PersonaGuard,
    EntitlementGuard,
    AdminGuard,
    MEMBERSHIP_SOURCE,
    CLIENT_LINK_SOURCE,
    SELF_ADVISED_SOURCE,
    OFFICE_PLAN_SOURCE,
  ],
})
export class AccessModule {}
