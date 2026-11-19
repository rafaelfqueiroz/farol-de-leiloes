// SPEC-012 BR-012-29, DL-012-10 (D-48, CDC art. 49): what "a full refund of what it paid" is. Pure
// (AR-05).
//
// The office is given back every payment the subscription received: the FIRST invoice (the one that
// created the subscription) and every other paid invoice of it, an upgrade's proration paid inside
// the window included, each minus what was already refunded. Never "the latest invoice": after an
// upgrade that is the proration alone, and the first payment would be kept. An invoice that is
// still unpaid (a proration the customer has not paid) is VOIDED, so it cannot be paid after the
// subscription ended and the refund was made. Draft, void and uncollectible invoices hold no money.
import type { Decimal } from '../../common/money/money.js';

export interface InvoiceFacts {
  readonly id: string;
  readonly status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  /** AR-17: reais. */
  readonly amountPaid: Decimal;
  /** AR-17: reais. */
  readonly amountRefunded: Decimal;
}

export interface RefundStep {
  readonly invoiceId: string;
  /** AR-17: reais still to give back for this invoice. Always positive. */
  readonly amount: Decimal;
}

export interface RefundPlan {
  /** Paid invoices with money left to give back, in the order given. */
  readonly refunds: readonly RefundStep[];
  /** Unpaid invoices to void before the subscription ends. */
  readonly voids: readonly string[];
}

/**
 * Example: the create invoice paid R$ 199,90 and an upgrade proration paid R$ 80,00, none refunded,
 * and a second proration still open → refund 199,90 and 80,00, void the open one. A 100% coupon
 * invoice (paid 0) and an invoice refunded in full by hand have nothing left: no step.
 */
export function planRefund(invoices: readonly InvoiceFacts[]): RefundPlan {
  const refunds: RefundStep[] = [];
  const voids: string[] = [];
  for (const invoice of invoices) {
    if (invoice.status === 'open') {
      voids.push(invoice.id);
    } else if (invoice.status === 'paid') {
      const remaining = invoice.amountPaid.minus(invoice.amountRefunded);
      if (remaining.greaterThan(0)) refunds.push({ invoiceId: invoice.id, amount: remaining });
    }
  }
  return { refunds, voids };
}
