// SPEC-012: the shapes of the plans API as the pages read them (what the BFF forwards from
// `GET /api/plans` and `/api/office/subscription*`), and the one place the pages know its paths.
// Money is a decimal string of reais (AR-17), instants are ISO strings (AR-23): both are turned
// into text only by `Money` and `DateText`.

export type PlanInterval = 'month' | 'year';

export interface CatalogPlan {
  code: string;
  name: string;
  price: string;
  interval: PlanInterval;
  activeJourneyLimit: number;
}

export interface PlansResponse {
  items: CatalogPlan[];
  /** REFUND_WINDOW_DAYS: the number the refund notice states. */
  refundWindowDays: number;
}

export type SubscriptionStatus = 'PENDING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELING' | 'LAPSED';

export interface ScheduledChange {
  planCode: string;
  planName: string;
  activeJourneyLimit: number;
  price: string;
  interval: PlanInterval;
  at: string | null;
}

export interface OfficeSubscription {
  officeId: string;
  plan: { code: string; name: string; price: string; interval: PlanInterval };
  status: SubscriptionStatus;
  /** The limit in effect now: 0 once the subscription lapsed (BR-012-21). */
  activeJourneyLimit: number;
  inProgress: number;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  scheduledChange: ScheduledChange | null;
  canUndoScheduledChange: boolean;
  canUndoCancel: boolean;
  nextChargeAmount: string | null;
  lapsedAt: string | null;
  readOnlyAt: string | null;
  /** The office is read-only now (lapsed beyond the grace period), by the server's clock. */
  readOnly: boolean;
  firstPaidAt: string | null;
  refundEligibleUntil: string | null;
  refundWindowDays: number;
  graceDays: number;
}

export type InvoiceReason =
  'subscription_create' | 'subscription_cycle' | 'subscription_update' | 'other';
export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';

export interface Invoice {
  id: string;
  reason: InvoiceReason;
  periodStart: string | null;
  periodEnd: string | null;
  paidAt: string | null;
  amount: string;
  status: InvoiceStatus;
  hostedUrl: string | null;
}

export interface InvoicesPage {
  items: Invoice[];
  total: number;
  page: number;
  pageSize: number;
}

export type PlanChangeKind = 'keep' | 'release_schedule' | 'upgrade' | 'schedule';

export interface PlanChangePreview {
  change: PlanChangeKind;
  amountDue: string;
  currency: string;
  lines: { amount: string }[];
  effectiveAt: string | null;
  nextChargeAt: string | null;
  nextChargeAmount: string;
}

export type CheckoutState = 'PENDING' | 'CONFIRMED';

/**
 * A checkout ref is the id of our subscription record: 24 hex characters (a Mongo ObjectId). It
 * goes into a URL path, so nothing else is ever put there: no dots, no slashes, no encoding.
 */
const CHECKOUT_REF = /^[0-9a-f]{24}$/;

export function isCheckoutRef(value: string): boolean {
  return CHECKOUT_REF.test(value);
}

/** The paths of the BFF (app/api): one list, so a rename is one edit. */
export const PLANS_API = {
  plans: '/api/plans',
  subscription: '/api/office/subscription',
  invoices: '/api/office/subscription/invoices',
  checkout: '/api/office/subscription/checkout',
  change: '/api/office/subscription/change',
  changePreview: '/api/office/subscription/change-preview',
  cancel: '/api/office/subscription/cancel',
  undoCancel: '/api/office/subscription/undo-cancel',
  billingPortal: '/api/office/subscription/billing-portal',
  /** The status route of one checkout; the ref must be a checkout ref (`isCheckoutRef`). */
  checkoutStatus: (ref: string) => {
    if (!isCheckoutRef(ref)) throw new RangeError('Not a checkout ref');
    return `/api/subscriptions/checkout/${ref}/status`;
  },
} as const;

/** BR-012-12: the states in which the subscription is in effect (the limit applies). */
export function isInEffect(status: SubscriptionStatus): boolean {
  return status === 'ACTIVE' || status === 'PAST_DUE' || status === 'CANCELING';
}
