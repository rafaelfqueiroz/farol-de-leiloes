import type {
  EventRecording,
  PaymentEventsRepository,
} from '../../src/subscriptions/payment-events.repository.js';

type Port<T> = { [K in keyof T]: T[K] };

interface Ledger {
  type: string;
  receivedAt: Date;
  processedAt?: Date;
  emailClaimedAt?: Date;
}

/**
 * TS-03: an in-memory fake of the event ledger with the same semantics as the unique index and the
 * conditional claims. The MongoDB behaviour itself (the unique index under concurrent inserts, the
 * single winner of a claim) is proven in test/integration/subscriptions-repositories.spec.ts.
 */
export class FakePaymentEventsRepository implements Port<PaymentEventsRepository> {
  readonly ledger = new Map<string, Ledger>();

  async record(stripeEventId: string, type: string, receivedAt: Date): Promise<EventRecording> {
    const existing = this.ledger.get(stripeEventId);
    if (!existing) {
      this.ledger.set(stripeEventId, { type, receivedAt });
      return 'new';
    }
    return existing.processedAt === undefined ? 'unprocessed' : 'processed';
  }

  async markProcessed(stripeEventId: string, processedAt: Date): Promise<void> {
    const existing = this.ledger.get(stripeEventId);
    if (existing && existing.processedAt === undefined) existing.processedAt = processedAt;
  }

  async claimEmail(stripeEventId: string, claimedAt: Date): Promise<boolean> {
    const existing = this.ledger.get(stripeEventId);
    if (!existing || existing.emailClaimedAt !== undefined) return false;
    existing.emailClaimedAt = claimedAt;
    return true;
  }

  async releaseEmailClaim(stripeEventId: string): Promise<void> {
    const existing = this.ledger.get(stripeEventId);
    if (existing) delete existing.emailClaimedAt;
  }
}
