// AR-08: the only file that touches the payment event model (SC-11, BR-012-13). The event ledger:
// one document per provider event id, inserted before the event is handled and marked processed
// after it was handled in full.
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { serverOperators } from '../common/mongo/query-safety.js';
import { PaymentEventEntity, type PaymentEventDocument } from './schemas/payment-event.schema.js';

/** MongoDB's duplicate-key error code. */
const DUPLICATE_KEY = 11000;

/**
 * What recording a delivery found:
 *  - new: first time this event id is seen;
 *  - processed: seen and fully handled before: acknowledge and do nothing;
 *  - unprocessed: seen but never finished (a crash or a fault midway): handle it again.
 */
export type EventRecording = 'new' | 'processed' | 'unprocessed';

@Injectable()
export class PaymentEventsRepository {
  constructor(
    @InjectModel(PaymentEventEntity.name) private readonly model: Model<PaymentEventDocument>,
  ) {}

  /**
   * SC-11: inserts the event by its provider id. The unique index makes two concurrent first
   * deliveries end with one document; the loser reads what the winner left.
   */
  async record(stripeEventId: string, type: string, receivedAt: Date): Promise<EventRecording> {
    try {
      await this.model.create([{ stripeEventId, type, receivedAt }]);
      return 'new';
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== DUPLICATE_KEY) throw error;
    }
    const existing = await this.model
      .findOne({ stripeEventId: { $eq: stripeEventId } })
      .select('processedAt')
      .lean<{ processedAt?: Date }>()
      .exec();
    return existing?.processedAt === undefined ? 'unprocessed' : 'processed';
  }

  /** Marks the event handled, once. Called only after everything it needed succeeded. */
  async markProcessed(stripeEventId: string, processedAt: Date): Promise<void> {
    await this.model
      .updateOne(
        { stripeEventId: { $eq: stripeEventId }, processedAt: null },
        { $set: { processedAt } },
      )
      .exec();
  }

  /**
   * BR-012-20: claims the right to send the payment-failed email for this event, in ONE
   * conditional update. Exactly one delivery gets true; a replay gets false and sends nothing.
   */
  async claimEmail(stripeEventId: string, claimedAt: Date): Promise<boolean> {
    const result = await this.model
      .updateOne(
        { stripeEventId: { $eq: stripeEventId }, emailClaimedAt: null },
        { $set: { emailClaimedAt: claimedAt } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** A send that failed gives the claim back, so the retried event sends it. */
  async releaseEmailClaim(stripeEventId: string): Promise<void> {
    await this.model
      .updateOne(
        { stripeEventId: { $eq: stripeEventId }, emailClaimedAt: serverOperators({ $ne: null }) },
        { $unset: { emailClaimedAt: '' } },
      )
      .exec();
  }
}
