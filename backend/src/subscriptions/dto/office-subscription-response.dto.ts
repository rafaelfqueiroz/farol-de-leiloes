// AR-36: the office plan page, each field copied explicitly. Money is a string of reais (AR-17),
// instants are ISO strings (BR-012-15 formats them in Brasília time at the edge). No provider id,
// customer, lease or refund bookkeeping leaves the API.
import { ApiProperty } from '@nestjs/swagger';
import { MONEY_API_PROPERTY, moneyToJson } from '../../common/money/money-dto.js';
import type { InvoiceReason, ProviderInvoice } from '../../payments/payment-gateway.js';
import { PLAN_INTERVALS } from '../../plans/plan.js';
import { SUBSCRIPTION_STATUSES } from '../domain/subscription-status.js';
import type {
  CheckoutState,
  OfficeSubscriptionView,
  PlanChangePreviewView,
} from '../subscriptions-billing.service.js';

const INVOICE_STATUSES = ['draft', 'open', 'paid', 'uncollectible', 'void'] as const;
const INVOICE_REASONS = [
  'subscription_create',
  'subscription_cycle',
  'subscription_update',
  'other',
] as const;
const DATE_TIME = { type: String, format: 'date-time', nullable: true } as const;

const iso = (date: Date | null): string | null => (date === null ? null : date.toISOString());

export class InvoiceResponseDto {
  @ApiProperty({ type: String })
  id: string;

  @ApiProperty({
    enum: INVOICE_REASONS,
    enumName: 'InvoiceReason',
    description: 'A period charge, or the proration of a plan change (subscription_update)',
  })
  reason: InvoiceReason;

  @ApiProperty({ ...DATE_TIME, description: 'Start of the service period it charges' })
  periodStart: string | null;

  @ApiProperty({ ...DATE_TIME, description: 'End of the service period it charges' })
  periodEnd: string | null;

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
    this.reason = invoice.reason;
    this.periodStart = iso(invoice.periodStart);
    this.periodEnd = iso(invoice.periodEnd);
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

  @ApiProperty({ ...MONEY_API_PROPERTY, description: 'Price per interval of the plan it moves to' })
  price: string;

  @ApiProperty({ enum: PLAN_INTERVALS, enumName: 'PlanInterval' })
  interval: string;

  @ApiProperty({ ...DATE_TIME, description: 'When the change takes effect (BR-012-17)' })
  at: string | null;

  constructor(change: NonNullable<OfficeSubscriptionView['scheduledChange']>) {
    this.planCode = change.planCode;
    this.planName = change.planName;
    this.activeJourneyLimit = change.activeJourneyLimit;
    this.price = moneyToJson(change.price);
    this.interval = change.interval;
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

  @ApiProperty({
    type: Boolean,
    description: 'Choosing the plan in effect releases the scheduled change (BR-012-17)',
  })
  canUndoScheduledChange: boolean;

  @ApiProperty({
    type: Boolean,
    description: 'Renewal was stopped and the paid period has not ended (BR-012-19)',
  })
  canUndoCancel: boolean;

  @ApiProperty({
    ...MONEY_API_PROPERTY,
    nullable: true,
    description:
      'What the next charge is; null when nothing renews. Catalog prices, before coupons',
  })
  nextChargeAmount: string | null;

  @ApiProperty({ ...DATE_TIME, description: 'When the subscription lapsed (BR-012-21)' })
  lapsedAt: string | null;

  @ApiProperty({ ...DATE_TIME, description: 'When the office turns read-only (BR-012-28)' })
  readOnlyAt: string | null;

  @ApiProperty({
    type: Boolean,
    description: 'The office is read-only now: lapsed beyond the grace period (BR-012-28)',
  })
  readOnly: boolean;

  @ApiProperty({ ...DATE_TIME, description: 'The provider confirmation of the first payment' })
  firstPaidAt: string | null;

  @ApiProperty({
    ...DATE_TIME,
    description: 'Until when cancelling refunds in full (BR-012-29); null when it does not',
  })
  refundEligibleUntil: string | null;

  @ApiProperty({
    type: Number,
    minimum: 1,
    description: 'Days after the first payment with a full refund (BR-012-29)',
  })
  refundWindowDays: number;

  @ApiProperty({
    type: Number,
    minimum: 0,
    description: 'Days a lapsed office keeps working before it turns read-only (BR-012-28)',
  })
  graceDays: number;

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
    this.canUndoScheduledChange = view.canUndoScheduledChange;
    this.canUndoCancel = view.canUndoCancel;
    this.nextChargeAmount =
      view.nextChargeAmount === null ? null : moneyToJson(view.nextChargeAmount);
    this.lapsedAt = iso(view.lapsedAt);
    this.readOnlyAt = iso(view.readOnlyAt);
    this.readOnly = view.readOnly;
    this.firstPaidAt = iso(view.firstPaidAt);
    this.refundEligibleUntil = iso(view.refundEligibleUntil);
    this.refundWindowDays = view.refundWindowDays;
    this.graceDays = view.graceDays;
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

export class PlanChangeLineResponseDto {
  @ApiProperty({
    ...MONEY_API_PROPERTY,
    description: 'Signed reais: a charge is positive, the credit for the unused time negative',
  })
  amount: string;

  constructor(amount: PlanChangePreviewView['lines'][number]) {
    this.amount = moneyToJson(amount.amount);
  }
}

/** BR-012-16..BR-012-18: what choosing a plan would do, before confirming. Changes nothing. */
export class PlanChangePreviewResponseDto {
  @ApiProperty({
    enum: ['keep', 'release_schedule', 'upgrade', 'schedule'],
    enumName: 'PlanChangeKind',
    description:
      'upgrade: now, once the prorated amount is paid; schedule: next period; release_schedule: ' +
      'drops the scheduled change; keep: nothing changes',
  })
  change: string;

  @ApiProperty({
    ...MONEY_API_PROPERTY,
    description: 'What the provider would charge now, in reais',
  })
  amountDue: string;

  @ApiProperty({ type: String, example: 'BRL' })
  currency: string;

  @ApiProperty({ type: () => [PlanChangeLineResponseDto] })
  lines: PlanChangeLineResponseDto[];

  @ApiProperty({ ...DATE_TIME, description: 'When a scheduled change starts; null otherwise' })
  effectiveAt: string | null;

  @ApiProperty({ ...DATE_TIME })
  nextChargeAt: string | null;

  @ApiProperty({ ...MONEY_API_PROPERTY, description: 'The next charge after the change, in reais' })
  nextChargeAmount: string;

  constructor(preview: PlanChangePreviewView) {
    this.change = preview.change;
    this.amountDue = moneyToJson(preview.amountDue);
    this.currency = preview.currency;
    this.lines = preview.lines.map((line) => new PlanChangeLineResponseDto(line));
    this.effectiveAt = iso(preview.effectiveAt);
    this.nextChargeAt = iso(preview.nextChargeAt);
    this.nextChargeAmount = moneyToJson(preview.nextChargeAmount);
  }
}
