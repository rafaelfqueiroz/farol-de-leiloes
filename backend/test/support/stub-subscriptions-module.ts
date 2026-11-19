// SPEC-012: AccessModule imports SubscriptionsModule for its OFFICE_PLAN_SOURCE binding, and that
// module needs MongoDB, the configuration and the payment gateway. A unit spec that imports
// AccessModule only to run the guards (no database, TS-01) swaps it for this one:
//
//   Test.createTestingModule({ imports: [...] })
//     .overrideModule(SubscriptionsModule).useModule(StubSubscriptionsModule)
//
// The plan source it provides is the one that knows no plan (before SPEC-012); a spec that needs
// plans overrides OFFICE_PLAN_SOURCE.
import { Module } from '@nestjs/common';
import { NoOfficePlanSource } from '../../src/access/sources/office-plan.source.js';
import { SubscriptionOfficePlanSource } from '../../src/subscriptions/subscription-office-plan.source.js';

@Module({
  providers: [{ provide: SubscriptionOfficePlanSource, useValue: new NoOfficePlanSource() }],
  exports: [SubscriptionOfficePlanSource],
})
export class StubSubscriptionsModule {}
