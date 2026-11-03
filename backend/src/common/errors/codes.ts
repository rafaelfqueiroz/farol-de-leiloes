// AR-37: the one catalogue of error codes the API answers with. Each code is a stable contract with
// the frontend, which turns it into pt-BR text (AR-39, `errors.<CODE>` in next-intl); a frontend
// test reads this file as text, so it stays a plain list of single-quoted literals, one per line,
// with no imports. Statuses live in error-status.ts.
export const ERROR_CODES = [
  // Generic: built-in HTTP outcomes and faults (api-exception.filter.ts)
  'VALIDATION_FAILED',
  'BAD_REQUEST',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'PAYLOAD_TOO_LARGE',
  'INTERNAL_ERROR',
  // Not found
  'AUCTION_NOT_FOUND',
  'USER_NOT_FOUND',
  'REMINDER_NOT_FOUND',
  'SAVED_FILTER_NOT_FOUND',
  'COUPON_NOT_FOUND',
  'SUBSCRIPTION_NOT_FOUND',
  // Accounts and sign-in
  'INVALID_CREDENTIALS',
  'CURRENT_PASSWORD_INCORRECT',
  'PASSWORD_ALREADY_SET',
  'OAUTH_ACCOUNT_HAS_NO_PASSWORD',
  'EMAIL_ALREADY_REGISTERED',
  'EMAIL_ALREADY_VERIFIED',
  'OAUTH_ACCOUNT_NEEDS_NO_VERIFICATION',
  'INVALID_VERIFICATION_TOKEN',
  'INVALID_RESET_TOKEN',
  'GOOGLE_ACCOUNT_WITHOUT_EMAIL',
  // Plans and payments
  'PLAN_NOT_ALLOWED',
  'INVALID_PLAN',
  'CHECKOUT_SESSION_FAILED',
  'INVALID_WEBHOOK_SIGNATURE',
  'COUPON_INVALID',
  // Saved filters
  'SAVED_FILTER_LIMIT_REACHED',
  'SAVED_FILTER_NAME_TAKEN',
  // Reminders
  'REMINDER_ALREADY_SENT',
  'REMINDER_DATE_IN_PAST',
  'REMINDER_AFTER_AUCTION_START',
  'AUCTION_START_DATE_MISSING',
  'AUCTION_ALREADY_STARTED',
  'EMAIL_VERIFICATION_REQUIRED',
  'PHONE_REQUIRED',
  'REMINDER_CHANNEL_NOT_IN_PLAN',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
