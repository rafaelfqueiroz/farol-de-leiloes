import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env';
import Stripe from 'stripe';
import { UsersService } from '../users/users.service';
import { CouponsService } from '../coupons/coupons.service';
import { DomainError } from '../common/errors/domain-error';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private stripe: Stripe;
  private webhookSecret: string;
  private standardPriceId: string;
  private frontendUrl: string;

  constructor(
    configService: ConfigService<Env, true>,
    private usersService: UsersService,
    private couponsService: CouponsService,
  ) {
    // AR-41: every Stripe value is required at boot, so none of them can be missing here.
    this.stripe = new Stripe(configService.get('STRIPE_SECRET_KEY', { infer: true }));
    this.webhookSecret = configService.get('STRIPE_WEBHOOK_SECRET', { infer: true });
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

    // Look up or create Stripe customer
    const user = await this.usersService.findByIdFull(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    let stripeCustomerId = user.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await this.stripe.customers.create({
        email,
        name: user.name,
        metadata: { userId },
      });
      stripeCustomerId = customer.id;
      await this.usersService.update(userId, { stripeCustomerId });
    }

    // Build checkout session params
    const sessionParams: Stripe.Checkout.SessionCreateParams = {
      mode: 'subscription',
      customer: stripeCustomerId,
      line_items: [{ price: this.standardPriceId, quantity: 1 }],
      success_url: `${this.frontendUrl}/plans/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${this.frontendUrl}/plans/cancel`,
      metadata: { userId },
    };

    // Apply coupon if provided
    if (couponCode) {
      const coupon = await this.couponsService.validateCoupon(couponCode);
      if (coupon.stripePromotionCodeId) {
        sessionParams.discounts = [{ promotion_code: coupon.stripePromotionCodeId }];
      }
    }

    const session = await this.stripe.checkout.sessions.create(sessionParams);

    if (!session.url) {
      throw new DomainError('CHECKOUT_SESSION_FAILED');
    }

    return { url: session.url };
  }

  async handleWebhook(rawBody: Buffer, signature: string): Promise<void> {
    let event: Stripe.Event;

    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    } catch (err) {
      this.logger.error(`Webhook signature verification failed: ${err}`);
      throw new DomainError('INVALID_WEBHOOK_SIGNATURE');
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        if (userId && session.subscription) {
          await this.usersService.update(userId, {
            stripeSubscriptionId: session.subscription as string,
            subscriptionStatus: 'active',
            role: 'standard',
          });
          this.logger.log(`Subscription activated for user ${userId}`);
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object as Stripe.Subscription;
        await this.syncSubscription(subscription);
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        const user = await this.usersService.findByStripeCustomerId(
          subscription.customer as string,
        );
        if (user) {
          await this.usersService.update(user._id.toString(), {
            subscriptionStatus: 'canceled',
            role: 'free',
          });
          this.logger.log(`Subscription canceled for user ${user._id}`);
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const user = await this.usersService.findByStripeCustomerId(invoice.customer as string);
        if (user) {
          await this.usersService.update(user._id.toString(), {
            subscriptionStatus: 'past_due',
          });
          this.logger.warn(`Payment failed for user ${user._id}`);
        }
        break;
      }

      default:
        this.logger.log(`Unhandled event type: ${event.type}`);
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

    await this.stripe.subscriptions.cancel(user.stripeSubscriptionId);

    await this.usersService.update(userId, {
      subscriptionStatus: 'canceled',
      role: 'free',
    });
  }

  private async syncSubscription(subscription: Stripe.Subscription): Promise<void> {
    const user = await this.usersService.findByStripeCustomerId(subscription.customer as string);
    if (!user) return;

    const status = subscription.status;
    let role = 'free';

    if (status === 'active' || status === 'trialing') {
      role = 'standard';
    }

    await this.usersService.update(user._id.toString(), {
      subscriptionStatus: status,
      role,
    });
  }
}
