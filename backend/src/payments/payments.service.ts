import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.js';
import { UsersService } from '../users/users.service.js';
import { CouponsService } from '../coupons/coupons.service.js';
import { DomainError } from '../common/errors/domain-error.js';
import { logSafeError } from '../common/errors/log-safe-error.js';
import { PaymentGateway, type PaymentEvent } from './payment-gateway.js';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly standardPriceId: string;
  private readonly frontendUrl: string;

  constructor(
    configService: ConfigService<Env, true>,
    private readonly usersService: UsersService,
    private readonly couponsService: CouponsService,
    // AR-10: the payment provider through its port; Stripe is the adapter's concern.
    private readonly paymentGateway: PaymentGateway,
  ) {
    // AR-41: every value is required at boot, so none of them can be missing here.
    this.standardPriceId = configService.get('STRIPE_STANDARD_PRICE_ID', { infer: true });
    this.frontendUrl = configService.get('FRONTEND_URL', { infer: true });
  }

  async createCheckoutSession(
    userId: string,
    email: string,
    planId: string,
    couponCode?: string,
  ): Promise<{ url: string }> {
    if (planId !== 'standard') {
      throw new DomainError('INVALID_PLAN');
    }

    // Look up or create the provider's customer
    const user = await this.usersService.findByIdFull(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await this.paymentGateway.createCustomer({
        email,
        name: user.name,
        userId,
      });
      stripeCustomerId = customer.id;
      await this.usersService.update(userId, { stripeCustomerId });
    }

    // Apply coupon if provided
    let promotionCodeId: string | undefined;
    if (couponCode) {
      const coupon = await this.couponsService.validateCoupon(couponCode);
      promotionCodeId = coupon.stripePromotionCodeId ?? undefined;
    }

    const session = await this.paymentGateway.createSubscriptionCheckout({
      customerId: stripeCustomerId,
      priceId: this.standardPriceId,
      successUrl: `${this.frontendUrl}/plans/success?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${this.frontendUrl}/plans/cancel`,
      userId,
      promotionCodeId,
    });

    if (!session.url) {
      throw new DomainError('CHECKOUT_SESSION_FAILED');
    }

    return { url: session.url };
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: PaymentEvent;

    try {
      event = this.paymentGateway.parseWebhookEvent(rawBody, signature);
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${logSafeError(err)}`);
      throw new DomainError('INVALID_WEBHOOK_SIGNATURE');
    }

    switch (event.type) {
      case 'checkout.completed': {
        if (event.userId && event.subscriptionId) {
          await this.usersService.update(event.userId, {
            stripeSubscriptionId: event.subscriptionId,
            subscriptionStatus: 'active',
            role: 'standard',
          });
          // SC-15 / AR-46: provider ids only; no user id until the hashed-id helper lands.
          this.logger.log(`Subscription activated: ${event.subscriptionId}`);
        }
        break;
      }

      case 'subscription.updated': {
        await this.syncSubscription(event.customerId, event.status);
        break;
      }

      case 'subscription.deleted': {
        const user = await this.findUserByCustomer(event.customerId);
        if (user) {
          await this.usersService.update(user._id.toString(), {
            subscriptionStatus: 'canceled',
            role: 'free',
          });
          this.logger.log(`Subscription canceled for Stripe customer ${event.customerId}`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const user = await this.findUserByCustomer(event.customerId);
        if (user) {
          await this.usersService.update(user._id.toString(), {
            subscriptionStatus: 'past_due',
          });
          this.logger.warn(`Payment failed for Stripe customer ${event.customerId}`);
        }
        break;
      }

      case 'unhandled':
        this.logger.log(`Unhandled event type: ${event.providerType}`);
    }
  }

  async getSubscriptionStatus(userId: string): Promise<{
    role: string;
    subscriptionStatus: string | null;
    stripeSubscriptionId: string | null;
  }> {
    const user = await this.usersService.findByIdFull(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }
    return {
      role: user.role ?? 'free',
      subscriptionStatus: user.subscriptionStatus ?? null,
      stripeSubscriptionId: user.stripeSubscriptionId ?? null,
    };
  }

  async cancelSubscription(userId: string): Promise<void> {
    const user = await this.usersService.findByIdFull(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    if (!user.stripeSubscriptionId) {
      throw new DomainError('SUBSCRIPTION_NOT_FOUND');
    }

    await this.paymentGateway.cancelSubscription(user.stripeSubscriptionId);

    await this.usersService.update(userId, {
      subscriptionStatus: 'canceled',
      role: 'free',
    });
  }

  private async findUserByCustomer(customerId: string | null) {
    return customerId ? this.usersService.findByStripeCustomerId(customerId) : null;
  }

  private async syncSubscription(customerId: string | null, status: string): Promise<void> {
    const user = await this.findUserByCustomer(customerId);
    if (!user) return;

    const role = status === 'active' || status === 'trialing' ? 'standard' : 'free';

    await this.usersService.update(user._id.toString(), {
      subscriptionStatus: status,
      role,
    });
  }
}
