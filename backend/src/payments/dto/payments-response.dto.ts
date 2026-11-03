// AR-36: the payment endpoints' responses, each field copied explicitly.
import { ApiProperty } from '@nestjs/swagger';

export const SUBSCRIPTION_STATUSES = ['active', 'canceled', 'past_due', 'incomplete'] as const;

export class CheckoutSessionResponseDto {
  @ApiProperty({ type: String, format: 'uri', description: 'Stripe Checkout page to redirect to' })
  url: string;

  constructor(session: { url: string }) {
    this.url = session.url;
  }
}

export class SubscriptionStatusResponseDto {
  @ApiProperty({ enum: ['admin', 'free', 'standard', 'premium'], enumName: 'Role' })
  role: string;

  @ApiProperty({ enum: SUBSCRIPTION_STATUSES, enumName: 'SubscriptionStatus', nullable: true })
  subscriptionStatus: string | null;

  @ApiProperty({ type: String, nullable: true })
  stripeSubscriptionId: string | null;

  constructor(status: {
    role: string;
    subscriptionStatus: string | null;
    stripeSubscriptionId: string | null;
  }) {
    this.role = status.role;
    this.subscriptionStatus = status.subscriptionStatus;
    this.stripeSubscriptionId = status.stripeSubscriptionId;
  }
}

/** What Stripe gets back once an event is verified and handled. */
export class WebhookAckResponseDto {
  @ApiProperty({ type: Boolean, description: 'Always true' })
  readonly received: boolean = true;
}
