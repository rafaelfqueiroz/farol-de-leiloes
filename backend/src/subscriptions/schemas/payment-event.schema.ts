import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { markIsolation } from '../../access/isolation-mark.js';

/**
 * SPEC-012 BR-012-13 / SC-11: one document per provider event id we acted on, so a delivery
 * repeated or retried is recognised. `processedAt` is set only after the event was fully handled:
 * a document without it means a delivery crashed or failed midway, and the next delivery handles
 * the event again (the sync is idempotent). Holds ids and instants only (SC-15).
 */
@Schema({ collection: 'paymentEvents', timestamps: true })
export class PaymentEventEntity {
  /** The provider's event id. */
  @Prop({ required: true, type: String })
  stripeEventId!: string;

  /** Our name of the event type (or the provider's, for an event we do not act on). */
  @Prop({ required: true, type: String })
  type!: string;

  @Prop({ required: true, type: Date })
  receivedAt!: Date;

  @Prop({ type: Date })
  processedAt?: Date;

  /**
   * BR-012-20: the payment-failed email is claimed before it is sent, so a replay sends it once;
   * a failed send releases the claim and the event is retried.
   */
  @Prop({ type: Date })
  emailClaimedAt?: Date;
}

export type PaymentEventDocument = HydratedDocument<PaymentEventEntity>;

export const PaymentEventSchema = SchemaFactory.createForClass(PaymentEventEntity);

// Built in production by migration 0006-subscription-indexes (AR-29).
// SC-11: the key of idempotency; two concurrent first deliveries end with one document.
PaymentEventSchema.index({ stripeEventId: 1 }, { unique: true });

// AR-16: provider bookkeeping, no owner, no personal data.
markIsolation(PaymentEventSchema, {
  kind: 'internal',
  reason:
    'Provider event ledger (SPEC-012 SC-11): event ids and instants only, read by the webhook handler for idempotency, never by an account',
});
