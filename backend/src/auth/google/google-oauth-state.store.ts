import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request } from 'express';
import { Clock } from '../../common/clock/clock.js';
import { DomainError } from '../../common/errors/domain-error.js';
import type { Env } from '../../config/env.js';
import { readCookie } from './cookie-header.js';
import {
  GOOGLE_STATE_TTL_MS,
  type GoogleFlowIntent,
  deriveStateKey,
  isGoogleFlowIntent,
  openState,
  sameState,
  sealState,
} from './google-oauth-state.seal.js';

export const GOOGLE_FLOW_COOKIE = 'farol_google_flow';
// The cookie goes to Google's return (a top-level GET navigation, which SameSite=Lax cookies
// accompany) and to nothing else of the site: /api is AR-32's prefix.
export const GOOGLE_FLOW_COOKIE_PATH = '/api/auth/google/callback'; // only the callback needs it

/**
 * The callback request once `verify` accepted it: what the flow that STARTED in this browser was
 * for. Set from the sealed cookie only (never from the query), so it cannot be forged.
 */
export type GoogleFlowRequest = Request & { googleFlowIntent?: GoogleFlowIntent };

/** The query parameter that starts a re-authentication instead of a sign-in. */
export const GOOGLE_INTENT_PARAM = 'intent';

type StoreCallback = (error: Error | null, state?: string) => void;
type VerifyCallback = (error: Error | null, verifier?: string | false, info?: unknown) => void;

/**
 * passport-oauth2's state store for the Google flow (issue #152, SC-02): the login-CSRF defence
 * without a server session. `GET /auth/google` mints a random `state` and a PKCE verifier (the
 * library makes the verifier and sends its S256 challenge), seals both into a short-lived
 * HttpOnly cookie signed with a key derived from JWT_SECRET, and sends `state` to Google;
 * `GET /auth/google/callback` only goes on when the `state` Google returned is the one in an
 * intact, unexpired cookie, then clears the cookie and hands the library the verifier for the
 * token request. A browser that did not start the flow (an attacker's `code` injected into a
 * victim's browser) has no cookie, or the attacker's, and never gets this far.
 *
 * passport-oauth2 chooses how to call these methods from their declared parameter count (`store`
 * with five, `verify` with three): do not add, remove or default a parameter.
 *
 * A refusal is always the closed code GOOGLE_SIGN_IN_FAILED; the state, the verifier and the
 * cookie are never in a message, a log or a URL (SC-15).
 */
@Injectable()
export class GoogleOAuthStateStore {
  private readonly key: Buffer;
  private readonly cookieOptions: CookieOptions;

  constructor(
    config: ConfigService<Env, true>,
    private readonly clock: Clock,
  ) {
    // AR-42: typed config. The key is made once, from the secret JWT signing already requires.
    this.key = deriveStateKey(config.get('JWT_SECRET', { infer: true }));
    this.cookieOptions = {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.get('NODE_ENV', { infer: true }) === 'production',
      path: GOOGLE_FLOW_COOKIE_PATH,
    };
  }

  /**
   * The intent of the flow that started in this browser, read from its sealed cookie, for a callback
   * that failed BEFORE `verify` ran (Google answering `error=access_denied` never reaches it). Only an
   * intact, unexpired cookie says anything; the cookie is single use, so it is cleared here too.
   * `undefined` for an ordinary sign-in and for anything that is not a cookie this server sealed.
   */
  flowIntentOf(req: Request): GoogleFlowIntent | undefined {
    const sealed = readCookie(req.headers.cookie, GOOGLE_FLOW_COOKIE);
    const opened = sealed === undefined ? null : openState(this.key, sealed, this.clock.now());
    req.res?.clearCookie(GOOGLE_FLOW_COOKIE, this.cookieOptions);
    return opened?.intent;
  }

  /** Called by passport when the person starts the flow. */
  store(
    req: Request,
    verifier: unknown,
    _state: unknown,
    _meta: unknown,
    callback: StoreCallback,
  ): void {
    if (typeof verifier !== 'string' || !req.res) {
      return callback(new Error('Google sign-in state could not be stored'));
    }
    // No `intent` is the ordinary sign-in; `reauth` is the only other one. Anything else is a
    // mistyped or hostile start, not a sign-in in disguise.
    const requested: unknown = req.query?.[GOOGLE_INTENT_PARAM];
    if (requested !== undefined && !isGoogleFlowIntent(requested)) {
      return callback(new DomainError('GOOGLE_SIGN_IN_FAILED'));
    }
    const state = randomBytes(32).toString('base64url');
    const sealed = sealState(
      this.key,
      requested === undefined ? { state, verifier } : { state, verifier, intent: requested },
      this.clock.now(),
    );
    req.res.cookie(GOOGLE_FLOW_COOKIE, sealed, {
      ...this.cookieOptions,
      maxAge: GOOGLE_STATE_TTL_MS,
    });
    callback(null, state);
  }

  /** Called by passport on the return from Google; answers the PKCE verifier to use. */
  verify(req: Request, providedState: unknown, callback: VerifyCallback): void {
    // Single use: whatever the outcome, the browser is told to drop the cookie.
    req.res?.clearCookie(GOOGLE_FLOW_COOKIE, this.cookieOptions);

    const sealed = readCookie(req.headers.cookie, GOOGLE_FLOW_COOKIE);
    const opened = sealed === undefined ? null : openState(this.key, sealed, this.clock.now());
    if (!opened || typeof providedState !== 'string' || !sameState(opened.state, providedState)) {
      return callback(new DomainError('GOOGLE_SIGN_IN_FAILED'));
    }
    // The intent travels from the cookie of the start to the callback handler, never via the URL.
    (req as GoogleFlowRequest).googleFlowIntent = opened.intent;
    callback(null, opened.verifier);
  }
}
