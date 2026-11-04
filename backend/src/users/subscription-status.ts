/** Stripe subscription states an account can be in; null means never subscribed. Single source of truth for the user schema and the auth and payments DTOs (AR-09: a plain value, not the schema). */
export const SUBSCRIPTION_STATUSES = ['active', 'canceled', 'past_due', 'incomplete'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];
