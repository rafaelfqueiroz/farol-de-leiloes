// SPEC-009: AccessModule imports SupportRequestsStoreModule for its SUPPORT_REQUEST_SOURCE binding, and
// that module needs MongoDB. A unit spec that imports AccessModule only to run the guards (no
// database, TS-01) swaps it for this one, like StubSubscriptionsModule:
//
//   Test.createTestingModule({ imports: [...] })
//     .overrideModule(SupportRequestsStoreModule).useModule(StubSupportRequestsStoreModule)
//
// The source it provides is the one that knows no support request (the default before SPEC-009), so
// no grant can be opened; a spec that needs requests overrides SUPPORT_REQUEST_SOURCE.
import { Module } from '@nestjs/common';
import { NoSupportRequestSource } from '../../src/access/sources/support-request.source.js';
import { SupportRequestsSource } from '../../src/support/support-requests.source.js';

@Module({
  providers: [{ provide: SupportRequestsSource, useValue: new NoSupportRequestSource() }],
  exports: [SupportRequestsSource],
})
export class StubSupportRequestsStoreModule {}
