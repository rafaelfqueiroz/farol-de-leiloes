import { Global, Module } from '@nestjs/common';
import { SubscriptionOfficePlanSource } from '../subscriptions/subscription-office-plan.source.js';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module.js';
import { AccessContextFactory } from './access-context.js';
import { AccessContextGuard } from './guards/access-context.guard.js';
import { AdminGuard } from './guards/admin.guard.js';
import { EntitlementGuard } from './guards/entitlement.guard.js';
import { PersonaGuard } from './guards/persona.guard.js';
import { CLIENT_LINK_SOURCE, NoClientLinkSource } from './sources/client-link.source.js';
import { MEMBERSHIP_SOURCE, NoMembershipSource } from './sources/membership.source.js';
import { OFFICE_PLAN_SOURCE } from './sources/office-plan.source.js';
import { NoSelfAdvisedSource, SELF_ADVISED_SOURCE } from './sources/self-advised.source.js';
import {
  NoSupportRequestSource,
  SUPPORT_REQUEST_SOURCE,
} from './sources/support-request.source.js';

/**
 * SPEC-002: the access context and the guards that read it (ARCHITECTURE §4).
 *
 * The five sources are the plug points of the specs that own the relationships. Each binding here
 * is a default that grants nothing; the owning spec replaces it with its own implementation:
 *
 *   MEMBERSHIP_SOURCE    SPEC-011 current office memberships
 *   CLIENT_LINK_SOURCE   SPEC-011 active/ended client links; SPEC-016 journeys as investor
 *   SELF_ADVISED_SOURCE  SPEC-011 self-advised status
 *   OFFICE_PLAN_SOURCE   SPEC-012 advisor plan, read-only state and entitlements (BOUND below, to
 *                        the subscriptions module's SubscriptionOfficePlanSource)
 *   SUPPORT_REQUEST_SOURCE  SPEC-009 support requests a support access grant hangs on (BR-002-24)
 *
 * BINDINGS (BR-002-21): a spec plugs its implementation in HERE, by replacing the default line below
 * (and importing its own module into this one if the implementation needs its services). Never bind
 * these tokens in another module: the API reaches AccessModule through AuthModule, and
 * `npm run grant-admin` through GrantAdminModule, which does not load the rest of the app. A binding
 * anywhere else would let one of the two read the permissive defaults, so grant-admin could grant
 * the admin capability to an office member or a client. A binding outside this file fails
 * test/structural/access-source-bindings.spec.ts.
 *
 * AccessContextGuard is registered as a global guard by AuthModule, right after JwtAuthGuard.
 */
@Global()
@Module({
  // SPEC-012: the office plan comes from the subscriptions module. SubscriptionsModule imports
  // nothing of auth or access, so this adds no cycle with AuthModule; AccessModule is also what
  // `npm run grant-admin` imports, so both read the same plan source.
  imports: [SubscriptionsModule],
  providers: [
    AccessContextFactory,
    AccessContextGuard,
    PersonaGuard,
    EntitlementGuard,
    AdminGuard,
    { provide: MEMBERSHIP_SOURCE, useClass: NoMembershipSource },
    { provide: CLIENT_LINK_SOURCE, useClass: NoClientLinkSource },
    { provide: SELF_ADVISED_SOURCE, useClass: NoSelfAdvisedSource },
    { provide: OFFICE_PLAN_SOURCE, useExisting: SubscriptionOfficePlanSource },
    { provide: SUPPORT_REQUEST_SOURCE, useClass: NoSupportRequestSource },
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
    SUPPORT_REQUEST_SOURCE,
  ],
})
export class AccessModule {}
