// SPEC-012 BR-012-29, DL-012-10: what a full refund of what the subscription paid is, by hand.
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../common/money/money.js';
import { type InvoiceFacts, planRefund } from './refund-plan.js';

const invoice = (
  id: string,
  status: InvoiceFacts['status'],
  paid: string,
  refunded = '0',
): InvoiceFacts => ({
  id,
  status,
  amountPaid: new Decimal(paid),
  amountRefunded: new Decimal(refunded),
});
const amounts = (invoices: InvoiceFacts[]) =>
  planRefund(invoices).refunds.map((step) => [step.invoiceId, step.amount.toFixed()]);

describe('planRefund', () => {
  it('BR-012-29: the first payment alone is refunded in full', () => {
    expect(amounts([invoice('in_create', 'paid', '199.90')])).toEqual([['in_create', '199.9']]);
  });

  it('DL-012-10: an upgrade proration paid inside the window is refunded with the first payment, not instead of it', () => {
    // The latest invoice is the proration (R$ 80,00): refunding only it would keep R$ 199,90.
    const plan = planRefund([
      invoice('in_proration', 'paid', '80.00'),
      invoice('in_create', 'paid', '199.90'),
    ]);

    expect(plan.refunds.map((step) => [step.invoiceId, step.amount.toFixed()])).toEqual([
      ['in_proration', '80'],
      ['in_create', '199.9'],
    ]);
    expect(plan.voids).toEqual([]);
  });

  it('an unpaid proration is voided, never refunded', () => {
    const plan = planRefund([
      invoice('in_open', 'open', '0'),
      invoice('in_create', 'paid', '199.90'),
    ]);

    expect(plan.voids).toEqual(['in_open']);
    expect(plan.refunds.map((step) => step.invoiceId)).toEqual(['in_create']);
  });

  it('what was already refunded is not refunded again: only the rest', () => {
    // R$ 199,90 paid, R$ 50,00 given back by hand → R$ 149,90 left (199.90 - 50.00).
    expect(amounts([invoice('in_create', 'paid', '199.90', '50.00')])).toEqual([
      ['in_create', '149.9'],
    ]);
  });

  it('nothing is left to give back for an invoice refunded in full, a 100% coupon or an over-refunded one', () => {
    expect(
      amounts([
        invoice('in_full', 'paid', '199.90', '199.90'),
        invoice('in_free', 'paid', '0'),
        invoice('in_over', 'paid', '10', '12'),
      ]),
    ).toEqual([]);
  });

  it('draft, void and uncollectible invoices hold no money and need nothing', () => {
    const plan = planRefund([
      invoice('in_draft', 'draft', '0'),
      invoice('in_void', 'void', '0'),
      invoice('in_bad', 'uncollectible', '0'),
    ]);

    expect(plan).toEqual({ refunds: [], voids: [] });
  });

  it('no invoices, no steps', () => {
    expect(planRefund([])).toEqual({ refunds: [], voids: [] });
  });
});
