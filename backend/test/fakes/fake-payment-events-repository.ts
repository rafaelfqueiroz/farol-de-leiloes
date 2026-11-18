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
  emailClaimedUntil?: Date;
  emailSentAt?: Date;
  processingToken?: string;
  processingUntil?: Date;
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

  async claimProcessing(
    stripeEventId: string,
    token: string,
    now: Date,
    until: Date,
  ): Promise<boolean> {
    const existing = this.ledger.get(stripeEventId);
    if (!existing || existing.processedAt !== undefined) return false;
    if (
      existing.processingUntil !== undefined &&
      existing.processingUntil.getTime() > now.getTime()
    ) {
      return false;
    }
    existing.processingToken = token;
    existing.processingUntil = until;
    return true;
  }

  async releaseProcessing(stripeEventId: string, token: string): Promise<void> {
    const existing = this.ledger.get(stripeEventId);
    if (existing?.processingToken === token) {
      delete existing.processingToken;
      delete existing.processingUntil;
    }
  }

  async markProcessed(stripeEventId: string, processedAt: Date): Promise<void> {
    const existing = this.ledger.get(stripeEventId);
    if (existing && existing.processedAt === undefined) {
      existing.processedAt = processedAt;
      delete existing.processingToken;
      delete existing.processingUntil;
    }
  }

  async claimEmail(stripeEventId: string, claimedAt: Date, until: Date): Promise<boolean> {
    const existing = this.ledger.get(stripeEventId);
    if (!existing || existing.emailSentAt !== undefined) return false;
    const live =
      existing.emailClaimedAt !== undefined &&
      (existing.emailClaimedUntil === undefined ||
        existing.emailClaimedUntil.getTime() > claimedAt.getTime());
    if (live) return false;
    existing.emailClaimedAt = claimedAt;
    existing.emailClaimedUntil = until;
    return true;
  }

  async markEmailSent(stripeEventId: string, sentAt: Date): Promise<void> {
    const existing = this.ledger.get(stripeEventId);
    if (existing && existing.emailSentAt === undefined) existing.emailSentAt = sentAt;
  }

  async releaseEmailClaim(stripeEventId: string): Promise<void> {
    const existing = this.ledger.get(stripeEventId);
    if (existing && existing.emailSentAt === undefined) {
      delete existing.emailClaimedAt;
      delete existing.emailClaimedUntil;
    }
  }
}
