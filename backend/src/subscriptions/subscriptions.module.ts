import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { OwnerCountersModule } from '../access/owner-counters.module.js';
import { CommonModule } from '../common/common.module.js';
import { EmailModule } from '../email/email.module.js';
import businessConfig from '../config/business.config.js';
import { PaymentGatewayModule } from '../payments/payment-gateway.module.js';
import { PlansModule } from '../plans/plans.module.js';
import { JourneySlotsService } from './journey-slots.service.js';
import { PaymentEventsRepository } from './payment-events.repository.js';
import { EmailPaymentFailedNotifier } from './payment-failed-email.notifier.js';
import { NoOfficeMembersSource, OFFICE_MEMBERS_SOURCE } from './ports/office-members.source.js';
import { OFFICE_PROVISIONER, UnavailableOfficeProvisioner } from './ports/office-provisioner.js';
import { PAYMENT_FAILED_NOTIFIER } from './ports/payment-failed.notifier.js';
import { PaymentEventEntity, PaymentEventSchema } from './schemas/payment-event.schema.js';
import { SubscriptionEntity, SubscriptionSchema } from './schemas/subscription.schema.js';
import { SubscriptionOfficePlanSource } from './subscription-office-plan.source.js';
import { SubscriptionsRepository } from './subscriptions.repository.js';
import { SubscriptionsService } from './subscriptions.service.js';

/**
 * SPEC-012 BR-012-06..BR-012-14 (ARCHITECTURE §13, ADR-005): office subscriptions, synced from the
 * payment provider, and the office plan the access context reads.
 *
 * The ports below are the plug points of the specs that own the other side. Each default fails
 * closed; the owning spec replaces its line (importing its own module here):
 *
 *   OFFICE_PROVISIONER    SPEC-011 creates the office of a first payment (idempotent by ref)
 *   OFFICE_MEMBERS_SOURCE SPEC-011 the contacts of an office's current members
 *   PAYMENT_FAILED_NOTIFIER  SPEC-012's own email to every member (BOUND here, BR-012-20)
 *
 * `SubscriptionOfficePlanSource` is exported for AccessModule, which binds it to OFFICE_PLAN_SOURCE
 * (the only place that token may be bound, BR-002-21). This module imports nothing of auth or
 * access, so AccessModule importing it makes no cycle.
 */
@Module({
  imports: [
    ConfigModule.forFeature(businessConfig),
    MongooseModule.forFeature([
      { name: SubscriptionEntity.name, schema: SubscriptionSchema },
      { name: PaymentEventEntity.name, schema: PaymentEventSchema },
    ]),
    CommonModule, // AR-24: the Clock
    PaymentGatewayModule, // AR-10
    PlansModule,
    EmailModule, // BR-012-20: the payment-failed email
    OwnerCountersModule, // BR-012-22..25: the journey slots
  ],
  providers: [
    SubscriptionsRepository,
    PaymentEventsRepository,
    SubscriptionsService,
    SubscriptionOfficePlanSource,
    { provide: OFFICE_PROVISIONER, useClass: UnavailableOfficeProvisioner },
    { provide: OFFICE_MEMBERS_SOURCE, useClass: NoOfficeMembersSource },
    { provide: PAYMENT_FAILED_NOTIFIER, useClass: EmailPaymentFailedNotifier },
    JourneySlotsService,
  ],
  exports: [
    SubscriptionsService,
    // The billing module (same bounded context) and SPEC-016 (journey slots).
    SubscriptionsRepository,
    JourneySlotsService,
    SubscriptionOfficePlanSource,
    OFFICE_PROVISIONER,
    OFFICE_MEMBERS_SOURCE,
  ],
})
export class SubscriptionsModule {}
