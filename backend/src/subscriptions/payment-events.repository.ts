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

  /**
   * SC-11: marks the event as being handled by this delivery, in ONE conditional update, so two
   * concurrent deliveries of the SAME event id do not both run the handler. Free means not yet
   * processed and no live claim (or one that expired: its holder died). True for exactly one of
   * any number of concurrent callers.
   */
  async claimProcessing(
    stripeEventId: string,
    token: string,
    now: Date,
    until: Date,
  ): Promise<boolean> {
    const result = await this.model
      .updateOne(
        {
          stripeEventId: { $eq: stripeEventId },
          processedAt: null,
          $or: [{ processingUntil: null }, { processingUntil: serverOperators({ $lte: now }) }],
        },
        { $set: { processingToken: token, processingUntil: until } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** A delivery that failed gives its claim back, so the provider's retry starts at once. */
  async releaseProcessing(stripeEventId: string, token: string): Promise<void> {
    await this.model
      .updateOne(
        { stripeEventId: { $eq: stripeEventId }, processingToken: { $eq: token } },
        { $unset: { processingToken: '', processingUntil: '' } },
      )
      .exec();
  }

  /** Marks the event handled, once. Called only after everything it needed succeeded. */
  async markProcessed(stripeEventId: string, processedAt: Date): Promise<void> {
    await this.model
      .updateOne(
        { stripeEventId: { $eq: stripeEventId }, processedAt: null },
        { $set: { processedAt }, $unset: { processingToken: '', processingUntil: '' } },
      )
      .exec();
  }

  /**
   * BR-012-20: claims the right to send the payment-failed email for this event, in ONE
   * conditional update. It is a LEASE: exactly one delivery gets true while the claim is live, a
   * claim whose holder died before it sent (past `until`) can be taken again, and once somebody
   * was told (`markEmailSent`) the email is never claimed again.
   */
  async claimEmail(stripeEventId: string, claimedAt: Date, until: Date): Promise<boolean> {
    const result = await this.model
      .updateOne(
        {
          stripeEventId: { $eq: stripeEventId },
          emailSentAt: null,
          $or: [
            { emailClaimedAt: null },
            { emailClaimedUntil: serverOperators({ $lte: claimedAt }) },
          ],
        },
        { $set: { emailClaimedAt: claimedAt, emailClaimedUntil: until } },
      )
      .exec();
    return result.modifiedCount === 1;
  }

  /** Somebody was told: the email is done for this event, for good. */
  async markEmailSent(stripeEventId: string, sentAt: Date): Promise<void> {
    await this.model
      .updateOne(
        { stripeEventId: { $eq: stripeEventId }, emailSentAt: null },
        { $set: { emailSentAt: sentAt } },
      )
      .exec();
  }

  /** A send that failed, or that reached nobody, gives the claim back, so the retried event sends it. */
  async releaseEmailClaim(stripeEventId: string): Promise<void> {
    await this.model
      .updateOne(
        { stripeEventId: { $eq: stripeEventId }, emailSentAt: null },
        { $unset: { emailClaimedAt: '', emailClaimedUntil: '' } },
      )
      .exec();
  }
}
