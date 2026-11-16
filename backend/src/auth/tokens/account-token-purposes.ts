// BR-001-05/22 and DL-001-06: how long each kind of one-time link lives. They are rules of the
// spec, not tunables, so they sit here once instead of in the services that issue them. The
// `google_exchange` code (BR-001-20) only bridges the Google redirect, hence 60 seconds.
export const ACCOUNT_TOKEN_PURPOSES = [
  'email_confirmation',
  'account_recovery',
  'google_exchange',
] as const;

export type AccountTokenPurpose = (typeof ACCOUNT_TOKEN_PURPOSES)[number];

const SECOND_MS = 1000;
const HOUR_MS = 60 * 60 * SECOND_MS;

export const ACCOUNT_TOKEN_TTL_MS: Record<AccountTokenPurpose, number> = {
  email_confirmation: 24 * HOUR_MS, // BR-001-05
  account_recovery: HOUR_MS, // BR-001-22
  google_exchange: 60 * SECOND_MS, // BR-001-20
};

/** BR-001-23: at least 128 bits; SC-06 asks for 32 bytes. */
export const ACCOUNT_TOKEN_BYTES = 32;
