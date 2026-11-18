// AR-38: the HTTP status of every code. A Record over ErrorCode, so a code added to the catalogue
// without a status fails to compile.
import { HttpStatus } from '@nestjs/common';
import type { ErrorCode } from './codes.js';

export const ERROR_STATUS: Record<ErrorCode, HttpStatus> = {
  VALIDATION_FAILED: HttpStatus.BAD_REQUEST,
  BAD_REQUEST: HttpStatus.BAD_REQUEST,
  UNAUTHENTICATED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  PAYLOAD_TOO_LARGE: HttpStatus.PAYLOAD_TOO_LARGE,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
  TOO_MANY_REQUESTS: HttpStatus.TOO_MANY_REQUESTS,

  AUCTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  USER_NOT_FOUND: HttpStatus.NOT_FOUND,
  REMINDER_NOT_FOUND: HttpStatus.NOT_FOUND,
  SAVED_FILTER_NOT_FOUND: HttpStatus.NOT_FOUND,
  COUPON_NOT_FOUND: HttpStatus.NOT_FOUND,
  SUBSCRIPTION_NOT_FOUND: HttpStatus.NOT_FOUND,
  MAINTENANCE_WINDOW_NOT_FOUND: HttpStatus.NOT_FOUND,

  // 401 means "not signed in" and the frontend treats it so; a wrong current password on a
  // signed-in request is a 400.
  INVALID_CREDENTIALS: HttpStatus.UNAUTHORIZED,
  CURRENT_PASSWORD_INCORRECT: HttpStatus.BAD_REQUEST,
  PASSWORD_ALREADY_SET: HttpStatus.CONFLICT,
  OAUTH_ACCOUNT_HAS_NO_PASSWORD: HttpStatus.CONFLICT,
  EMAIL_ALREADY_REGISTERED: HttpStatus.CONFLICT,
  EMAIL_ALREADY_VERIFIED: HttpStatus.CONFLICT,
  // BR-001-26 / D-63: the email of an account is read-only.
  EMAIL_CHANGE_UNAVAILABLE: HttpStatus.CONFLICT,
  OAUTH_ACCOUNT_NEEDS_NO_VERIFICATION: HttpStatus.CONFLICT,
  INVALID_VERIFICATION_TOKEN: HttpStatus.BAD_REQUEST,
  INVALID_RESET_TOKEN: HttpStatus.BAD_REQUEST,
  GOOGLE_ACCOUNT_WITHOUT_EMAIL: HttpStatus.UNAUTHORIZED,
  // BR-001-08: Google did not vouch for the address.
  GOOGLE_EMAIL_NOT_VERIFIED: HttpStatus.UNAUTHORIZED,
  // BR-001-16, BR-001-11: the account is not active, or Google's identity belongs to another
  // account; also an aborted or failed Google consent.
  GOOGLE_SIGN_IN_FAILED: HttpStatus.UNAUTHORIZED,
  // BR-001-20: the one-time code of the return from Google is unknown, used or expired.
  INVALID_GOOGLE_CODE: HttpStatus.BAD_REQUEST,
  // BR-001-15: too many failed sign-ins; the throttle answers even when the password is right.
  TOO_MANY_ATTEMPTS: HttpStatus.TOO_MANY_REQUESTS,

  // SPEC-002: refusals that involve no record, so a 403 reveals nothing (AR-14 covers records).
  // BR-002-14: the route needs a persona the account's relationships do not give.
  PERSONA_REQUIRED: HttpStatus.FORBIDDEN,
  // BR-002-30 / D-47: the office's plan lapsed beyond its grace period; writes are refused.
  OFFICE_READ_ONLY: HttpStatus.FORBIDDEN,

  PLAN_NOT_ALLOWED: HttpStatus.FORBIDDEN,
  INVALID_PLAN: HttpStatus.BAD_REQUEST,
  // Stripe answered without a checkout URL: an upstream failure, not the caller's.
  CHECKOUT_SESSION_FAILED: HttpStatus.BAD_GATEWAY,
  INVALID_WEBHOOK_SIGNATURE: HttpStatus.BAD_REQUEST,
  // SPEC-012 BR-012-13: another delivery is syncing the same subscription; the provider retries.
  WEBHOOK_BUSY: HttpStatus.SERVICE_UNAVAILABLE,
  COUPON_INVALID: HttpStatus.BAD_REQUEST,

  SAVED_FILTER_LIMIT_REACHED: HttpStatus.CONFLICT,
  SAVED_FILTER_NAME_TAKEN: HttpStatus.CONFLICT,

  REMINDER_ALREADY_SENT: HttpStatus.CONFLICT,
  REMINDER_DATE_IN_PAST: HttpStatus.BAD_REQUEST,
  REMINDER_AFTER_AUCTION_START: HttpStatus.BAD_REQUEST,
  AUCTION_START_DATE_MISSING: HttpStatus.UNPROCESSABLE_ENTITY,
  AUCTION_ALREADY_STARTED: HttpStatus.CONFLICT,
  EMAIL_VERIFICATION_REQUIRED: HttpStatus.FORBIDDEN,
  PHONE_REQUIRED: HttpStatus.UNPROCESSABLE_ENTITY,
  REMINDER_CHANNEL_NOT_IN_PLAN: HttpStatus.FORBIDDEN,

  // BR-003-03: a started window is part of the availability record and stays.
  MAINTENANCE_WINDOW_ALREADY_STARTED: HttpStatus.CONFLICT,
};
