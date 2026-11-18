// AR-36: the office plan page, each field copied explicitly. Money is a string of reais (AR-17),
// instants are ISO strings (BR-012-15 formats them in Brasília time at the edge). No provider id,
// customer, lease or refund bookkeeping leaves the API.
import { ApiProperty } from '@nestjs/swagger';
import { MONEY_API_PROPERTY, moneyToJson } from '../../common/money/money-dto.js';
import type { ProviderInvoice } from '../../payments/payment-gateway.js';
import { PLAN_INTERVALS } from '../../plans/plan.js';
import { SUBSCRIPTION_STATUSES } from '../domain/subscription-status.js';
import type { CheckoutState, OfficeSubscriptionView } from '../subscriptions-billing.service.js';

const INVOICE_STATUSES = ['draft', 'open', 'paid', 'uncollectible', 'void'] as const;
const DATE_TIME = { type: String, format: 'date-time', nullable: true } as const;

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

export class InvoiceResponseDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty(DATE_TIME)
  paidAt: string | null;

  @ApiProperty({ ...MONEY_API_PROPERTY, description: 'What the invoice charged, in reais' })
  amount: string;

  @ApiProperty({ enum: INVOICE_STATUSES, enumName: 'InvoiceStatus' })
  status: string;

  @ApiProperty({ type: String, nullable: true, description: 'The payment provider page' })
  hostedUrl: string | null;

  constructor(invoice: ProviderInvoice) {
    this.id = invoice.id;
    this.paidAt = iso(invoice.paidAt);
    this.amount = moneyToJson(invoice.amount);
    this.status = invoice.status;
    this.hostedUrl = invoice.hostedUrl;
  }
}

export class SubscriptionPlanResponseDto {
  @ApiProperty({ type: String })
  code: string;

  @ApiProperty({ type: String })
  name: string;

  @ApiProperty({ ...MONEY_API_PROPERTY, description: 'Price per billing interval, in reais' })
  price: string;

  @ApiProperty({ enum: PLAN_INTERVALS, enumName: 'PlanInterval' })
  interval: string;

  constructor(plan: OfficeSubscriptionView['plan']) {
    this.code = plan.code;
    this.name = plan.name;
    this.price = moneyToJson(plan.price);
    this.interval = plan.interval;
  }
}

export class ScheduledChangeResponseDto {
  @ApiProperty({ type: String })
  planCode: string;

  @ApiProperty({ type: String })
  planName: string;

  @ApiProperty({ type: Number, minimum: 1 })
  activeJourneyLimit: number;

  @ApiProperty({ ...DATE_TIME, description: 'When the change takes effect (BR-012-17)' })
  at: string | null;

  constructor(change: NonNullable<OfficeSubscriptionView['scheduledChange']>) {
    this.planCode = change.planCode;
    this.planName = change.planName;
    this.activeJourneyLimit = change.activeJourneyLimit;
    this.at = iso(change.at);
  }
}

export class OfficeSubscriptionResponseDto {
  @ApiProperty({ type: String })
  officeId: string;

  @ApiProperty({ type: () => SubscriptionPlanResponseDto })
  plan: SubscriptionPlanResponseDto;

  @ApiProperty({ enum: SUBSCRIPTION_STATUSES, enumName: 'SubscriptionStatus' })
  status: string;

  @ApiProperty({
    type: Number,
    minimum: 0,
    description:
      'The active-journey limit in effect now: 0 once the subscription lapsed (BR-012-21)',
  })
  activeJourneyLimit: number;

  @ApiProperty({ type: Number, minimum: 0, description: 'Journeys in progress (BR-012-26)' })
  inProgress: number;

  @ApiProperty(DATE_TIME)
  currentPeriodStart: string | null;

  @ApiProperty({ ...DATE_TIME, description: 'End of the paid period: the next charge date' })
  currentPeriodEnd: string | null;

  @ApiProperty({ type: Boolean, description: 'Renewal stopped; the plan ends with the period' })
  cancelAtPeriodEnd: boolean;

  @ApiProperty({ type: () => ScheduledChangeResponseDto, nullable: true })
  scheduledChange: ScheduledChangeResponseDto | null;

  @ApiProperty({ ...DATE_TIME, description: 'When the subscription lapsed (BR-012-21)' })
  lapsedAt: string | null;

  @ApiProperty({ ...DATE_TIME, description: 'When the office turns read-only (BR-012-28)' })
  readOnlyAt: string | null;

  @ApiProperty({ ...DATE_TIME, description: 'The provider confirmation of the first payment' })
  firstPaidAt: string | null;

  @ApiProperty({
    ...DATE_TIME,
    description: 'Until when cancelling refunds in full (BR-012-29); null when it does not',
  })
  refundEligibleUntil: string | null;

  @ApiProperty({
    type: () => [InvoiceResponseDto],
    nullable: true,
    description: 'Billing history, newest first; null when the provider could not be read',
  })
  invoices: InvoiceResponseDto[] | null;

  constructor(view: OfficeSubscriptionView) {
    this.officeId = view.officeId;
    this.plan = new SubscriptionPlanResponseDto(view.plan);
    this.status = view.status;
    this.activeJourneyLimit = view.activeJourneyLimit;
    this.inProgress = view.inProgress;
    this.currentPeriodStart = iso(view.currentPeriodStart);
    this.currentPeriodEnd = iso(view.currentPeriodEnd);
    this.cancelAtPeriodEnd = view.cancelAtPeriodEnd;
    this.scheduledChange =
      view.scheduledChange === null ? null : new ScheduledChangeResponseDto(view.scheduledChange);
    this.lapsedAt = iso(view.lapsedAt);
    this.readOnlyAt = iso(view.readOnlyAt);
    this.firstPaidAt = iso(view.firstPaidAt);
    this.refundEligibleUntil = iso(view.refundEligibleUntil);
    this.invoices =
      view.invoices === null
        ? null
        : view.invoices.map((invoice) => new InvoiceResponseDto(invoice));
  }
}

/** Where to send the browser: the provider's hosted page (BR-012-10). */
export class RedirectUrlResponseDto {
  @ApiProperty({ type: String, description: 'The payment provider hosted page' })
  url: string;

  constructor(url: string) {
    this.url = url;
  }
}

export class CheckoutStatusResponseDto {
  @ApiProperty({ enum: ['PENDING', 'CONFIRMED'], enumName: 'CheckoutState' })
  state: CheckoutState;

  constructor(state: CheckoutState) {
    this.state = state;
  }
}
