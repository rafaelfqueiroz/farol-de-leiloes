// AR-10 / TS-03: PaymentsService against FakePaymentGateway — the provider is a port, so the
// service is tested in its own vocabulary, with no Stripe types and no network (TS-07).
import { describe, expect, it, vi } from 'vitest';
import { PaymentsService } from './payments.service';
import { DomainError } from '../common/errors/domain-error';
import { FakePaymentGateway } from '../../test/fakes/fake-payment-gateway';
import { testConfigService, TEST_ENV } from '../../test/support/test-env';

type ServiceDeps = ConstructorParameters<typeof PaymentsService>;

function build(user: Record<string, unknown> | null = { name: 'Ana Teste' }) {
  const gateway = new FakePaymentGateway();
  const usersService = {
    findByIdFull: vi.fn().mockResolvedValue(user),
    findByStripeCustomerId: vi.fn().mockResolvedValue({ _id: 'u1' }),
    update: vi.fn().mockResolvedValue({}),
  };
  const couponsService = {
    validateCoupon: vi.fn().mockResolvedValue({ stripePromotionCodeId: 'promo_1' }),
  };
  const service = new PaymentsService(
    testConfigService(),
    usersService as unknown as ServiceDeps[1],
    couponsService as unknown as ServiceDeps[2],
    gateway,
  );
  return { service, gateway, usersService, couponsService };
}

describe('PaymentsService.createCheckoutSession', () => {
  it('creates the customer once, applies the coupon and answers the checkout URL', async () => {
    const { service, gateway, usersService } = build();

    await expect(
      service.createCheckoutSession('u1', 'ana@example.test', 'standard', 'bemvindo'),
    ).resolves.toEqual({ url: 'https://checkout.example.test/session' });

    expect(gateway.customers).toEqual([
      { email: 'ana@example.test', name: 'Ana Teste', userId: 'u1' },
    ]);
    expect(usersService.update).toHaveBeenCalledWith('u1', { stripeCustomerId: 'cus_fake_1' });
    expect(gateway.checkouts).toEqual([
      {
        customerId: 'cus_fake_1',
        priceId: TEST_ENV.STRIPE_STANDARD_PRICE_ID,
        successUrl: `${TEST_ENV.FRONTEND_URL}/plans/success?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${TEST_ENV.FRONTEND_URL}/plans/cancel`,
        userId: 'u1',
        promotionCodeId: 'promo_1',
      },
    ]);
  });

  it('reuses an existing customer and sends no promotion code without a coupon', async () => {
    const { service, gateway } = build({ name: 'Ana Teste', stripeCustomerId: 'cus_9' });

    await service.createCheckoutSession('u1', 'ana@example.test', 'standard');

    expect(gateway.customers).toEqual([]);
    expect(gateway.checkouts[0]).toMatchObject({ customerId: 'cus_9', promotionCodeId: undefined });
  });

  it('refuses an unknown plan, an unknown user and a session without a URL', async () => {
    await expect(build().service.createCheckoutSession('u1', 'e', 'gold')).rejects.toEqual(
      new DomainError('INVALID_PLAN'),
    );
    await expect(build(null).service.createCheckoutSession('u1', 'e', 'standard')).rejects.toEqual(
      new DomainError('USER_NOT_FOUND'),
    );

    const noUrl = build();
    noUrl.gateway.checkoutUrl = null;
    await expect(noUrl.service.createCheckoutSession('u1', 'e', 'standard')).rejects.toEqual(
      new DomainError('CHECKOUT_SESSION_FAILED'),
    );
  });
});

describe('PaymentsService.handleWebhook', () => {
  const body = Buffer.from('{}');

  it('refuses an event whose signature does not verify', async () => {
    const { service, gateway, usersService } = build();
    gateway.nextWebhookEvent = new Error('bad signature');

    await expect(service.handleWebhook(body, 'sig')).rejects.toEqual(
      new DomainError('INVALID_WEBHOOK_SIGNATURE'),
    );
    expect(usersService.update).not.toHaveBeenCalled();
  });

  it('activates the subscription on a completed checkout, and ignores an incomplete one', async () => {
    const { service, gateway, usersService } = build();
    gateway.nextWebhookEvent = { type: 'checkout.completed', userId: 'u1', subscriptionId: 's1' };

    await service.handleWebhook(body, 'sig');
    expect(usersService.update).toHaveBeenCalledWith('u1', {
      stripeSubscriptionId: 's1',
      subscriptionStatus: 'active',
      role: 'standard',
    });

    usersService.update.mockClear();
    gateway.nextWebhookEvent = { type: 'checkout.completed', userId: null, subscriptionId: 's1' };
    await service.handleWebhook(body, 'sig');
    expect(usersService.update).not.toHaveBeenCalled();
  });

  it.each([
    ['active', 'standard'],
    ['trialing', 'standard'],
    ['past_due', 'free'],
  ])('syncs a subscription now %s to the %s role', async (status, role) => {
    const { service, gateway, usersService } = build();
    gateway.nextWebhookEvent = { type: 'subscription.updated', customerId: 'cus_1', status };

    await service.handleWebhook(body, 'sig');

    expect(usersService.findByStripeCustomerId).toHaveBeenCalledWith('cus_1');
    expect(usersService.update).toHaveBeenCalledWith('u1', { subscriptionStatus: status, role });
  });

  it('downgrades on a deleted subscription and flags a failed payment', async () => {
    const { service, gateway, usersService } = build();

    gateway.nextWebhookEvent = { type: 'subscription.deleted', customerId: 'cus_1' };
    await service.handleWebhook(body, 'sig');
    expect(usersService.update).toHaveBeenLastCalledWith('u1', {
      subscriptionStatus: 'canceled',
      role: 'free',
    });

    gateway.nextWebhookEvent = { type: 'invoice.payment_failed', customerId: 'cus_1' };
    await service.handleWebhook(body, 'sig');
    expect(usersService.update).toHaveBeenLastCalledWith('u1', { subscriptionStatus: 'past_due' });
  });

  it('looks nobody up for an event without a customer, or one it does not handle', async () => {
    const { service, gateway, usersService } = build();

    gateway.nextWebhookEvent = { type: 'subscription.deleted', customerId: null };
    await service.handleWebhook(body, 'sig');
    gateway.nextWebhookEvent = { type: 'unhandled', providerType: 'charge.refunded' };
    await service.handleWebhook(body, 'sig');

    expect(usersService.findByStripeCustomerId).not.toHaveBeenCalled();
    expect(usersService.update).not.toHaveBeenCalled();
  });
});

describe('PaymentsService.cancelSubscription', () => {
  it('cancels at the provider, then downgrades the user', async () => {
    const { service, gateway, usersService } = build({ stripeSubscriptionId: 'sub_1' });

    await service.cancelSubscription('u1');

    expect(gateway.cancelledSubscriptions).toEqual(['sub_1']);
    expect(usersService.update).toHaveBeenCalledWith('u1', {
      subscriptionStatus: 'canceled',
      role: 'free',
    });
  });

  it('refuses a user without a subscription', async () => {
    const { service, gateway } = build({});

    await expect(service.cancelSubscription('u1')).rejects.toEqual(
      new DomainError('SUBSCRIPTION_NOT_FOUND'),
    );
    expect(gateway.cancelledSubscriptions).toEqual([]);
  });
});
