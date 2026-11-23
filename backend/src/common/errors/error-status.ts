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

  // SPEC-010 BR-010-05: a new version of the terms or the policy is in force and the account has not
  // accepted it; the context lists the documents. A 403 involves no record (AR-14).
  TERMS_ACCEPTANCE_REQUIRED: HttpStatus.FORBIDDEN,
  // BR-010-01, BR-010-05: the version the request names is not the current one; ask again.
  TERMS_VERSION_OUTDATED: HttpStatus.CONFLICT,
  // BR-010-13: deleting the account needs a current password or a fresh Google sign-in, and the
  // account has neither to give (no password and no Google identity).
  REAUTHENTICATION_UNAVAILABLE: HttpStatus.CONFLICT,
  // BR-010-11: the export the owner asked for is still being built.
  EXPORT_NOT_READY: HttpStatus.CONFLICT,
  // BR-010-11: the owner's export is past its 7 days (or was deleted); ask for another. Only the
  // owner ever sees it: another account's id is the same 404 as a missing one (AR-14).
  EXPORT_EXPIRED: HttpStatus.GONE,
  // BR-010-25: the feature handles third parties' data and the lawyer's validation is not recorded
  // in a production-like environment. The context names the scope only. A 403 involves no record.
  LEGAL_VALIDATION_REQUIRED: HttpStatus.FORBIDDEN,

  PLAN_NOT_ALLOWED: HttpStatus.FORBIDDEN,
  INVALID_PLAN: HttpStatus.BAD_REQUEST,
  // Stripe answered without a checkout URL: an upstream failure, not the caller's.
  CHECKOUT_SESSION_FAILED: HttpStatus.BAD_GATEWAY,
  INVALID_WEBHOOK_SIGNATURE: HttpStatus.BAD_REQUEST,
  // SPEC-012 BR-012-13: another delivery is syncing the same subscription; the provider retries.
  WEBHOOK_BUSY: HttpStatus.SERVICE_UNAVAILABLE,
  COUPON_INVALID: HttpStatus.BAD_REQUEST,
  // SPEC-012 BR-012-08: the office already has a subscription in effect; change it instead.
  SUBSCRIPTION_ALREADY_ACTIVE: HttpStatus.CONFLICT,
  // BR-012-19: there is nothing in effect to cancel.
  SUBSCRIPTION_NOT_CANCELABLE: HttpStatus.CONFLICT,
  // BR-012-16..18: the subscription is not in a state that allows this change.
  SUBSCRIPTION_NOT_CHANGEABLE: HttpStatus.CONFLICT,
  // A checkout of the same buyer (or office) is open or its payment is being confirmed.
  CHECKOUT_IN_PROGRESS: HttpStatus.CONFLICT,
  // BR-012-07: no office can be created for a first payment yet (SPEC-011): nothing is charged.
  OFFICE_CREATION_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  // The payment provider's billing portal could not be opened: an upstream failure.
  BILLING_PORTAL_FAILED: HttpStatus.BAD_GATEWAY,
  // The payment provider rejected a plan change (e.g. a price it cannot switch to): upstream.
  CHANGE_PLAN_FAILED: HttpStatus.BAD_GATEWAY,
  // The provider could not compute the prorated amount of an upgrade (nothing was changed): upstream.
  CHANGE_PREVIEW_FAILED: HttpStatus.BAD_GATEWAY,
  // BR-012-16: the quote the member confirmed no longer holds (expired, or the amount or the period
  // changed): nothing was charged; ask again and confirm the new amount.
  QUOTE_STALE: HttpStatus.CONFLICT,
  // The provider could not list the invoices (BR-012-11): the plan page works without them.
  BILLING_HISTORY_UNAVAILABLE: HttpStatus.BAD_GATEWAY,
  // BR-012-29: another member's cancel is refunding this subscription right now; retry shortly.
  CANCEL_IN_PROGRESS: HttpStatus.CONFLICT,
  // BR-012-23 / BR-012-25: the office is at its active-journey limit.
  JOURNEY_LIMIT_REACHED: HttpStatus.CONFLICT,

  SAVED_FILTER_LIMIT_REACHED: HttpStatus.CONFLICT,
  SAVED_FILTER_NAME_TAKEN: HttpStatus.CONFLICT,

  // SPEC-009 BR-009-08: the requester's own request is closed; its permission can no longer be
  // withdrawn because there is nothing left to withdraw. Only the owner ever sees it: another
  // account's id is the same 404 as a missing one (AR-14).
  SUPPORT_REQUEST_CLOSED: HttpStatus.CONFLICT,

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
