import { type BeforeApplicationShutdown, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service.js';
import { EmailService } from '../email/email.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { isAccountActive, type UserAccount } from '../users/user-account.js';
import {
  UserProfile,
  AuthResult,
  JwtPayload,
  GoogleExchangeResult,
} from './interfaces/auth.interface.js';
import { DomainError } from '../common/errors/domain-error.js';
import { Clock } from '../common/clock/clock.js';
import { normalizeEmail } from '../common/normalize-email.js';
import { AccountTokenService } from './tokens/account-token.service.js';
import { SessionsService } from './sessions/sessions.service.js';
import { LoginAttemptsService } from './login-attempts/login-attempts.service.js';
import { credentialVersionOf } from '../users/domain/credential-version.js';
import type { GoogleIdentity } from './google/google-identity.js';
import { ConsentsService, type AcceptedVersions } from '../privacy/consents.service.js';
import type { AcceptanceMethod } from '../privacy/domain/legal-versions.js';
import { WhatsappConsentService } from '../privacy/whatsapp-consent.service.js';

/**
 * SPEC-009 BR-009-20: why a Google sign-in of an account that is not active is refused: a DEACTIVATED
 * account is told so (the redirect carries this code to the sign-in page, which shows the support
 * address); closed, pending and every other case keep the generic failure (BR-001-16).
 */
function inactiveGoogleCode(
  account: { status?: string | null } | null,
): 'ACCOUNT_DEACTIVATED' | 'GOOGLE_SIGN_IN_FAILED' {
  return account?.status === 'deactivated' ? 'ACCOUNT_DEACTIVATED' : 'GOOGLE_SIGN_IN_FAILED';
}

function idOf(user: UserAccount): string {
  return typeof user._id === 'string' ? user._id : user._id.toHexString();
}

/**
 * SPEC-010 BR-010-13: the proof of identity that an irreversible request carries again: the current
 * password, or the one-time code of a fresh Google sign-in (never both: the DTO refuses that).
 */
export type ReauthenticationProof =
  | { readonly password: string; readonly googleCode?: undefined }
  | { readonly googleCode: string; readonly password?: undefined };

/** SPEC-010: what a sign-up carries beside the accepted terms (RegisterDto, GoogleCompleteDto). */
export interface SignupConsentInput {
  /** The versions the person was shown; omitted means the current ones (BR-010-01). */
  termsVersion?: string;
  privacyVersion?: string;
  /** The WhatsApp checkbox; omitted or false is recorded as declined (BR-010-27). */
  whatsappConsent?: boolean;
}

@Injectable()
export class AuthService implements BeforeApplicationShutdown {
  private readonly logger = new Logger(AuthService.name);
  /** Mail work started without being awaited (see `detach`). */
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
    private accountTokens: AccountTokenService,
    private sessions: SessionsService,
    private loginAttempts: LoginAttemptsService,
    private consents: ConsentsService,
    private whatsappConsent: WhatsappConsentService,
    private clock: Clock, // AR-24: the instant of a takeover's consent reset
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResult> {
    // BR-010-01: the versions the person was shown must be the current ones, checked BEFORE the
    // account exists so that a stale form creates nothing (TERMS_VERSION_OUTDATED, 409).
    const versions = this.consents.resolveVersions({
      terms: registerDto.termsVersion,
      privacy: registerDto.privacyVersion,
    });

    // BR-001-31: only email, name and password cross into the account; acceptTerms is checked by
    // the DTO (BR-001-02) and is not an account attribute.
    // SPEC-010 BR-010-01: the account is created `pending`: it authenticates nothing until it is
    // activated below, so no sign-in can find it before its consent records exist.
    const user = await this.usersService.createLocalAccount(
      {
        email: registerDto.email,
        name: registerDto.name,
        password: registerDto.password,
      },
      this.clock.now(),
    );

    // BR-010-03, BR-010-27: then the acceptance and the WhatsApp answer, then the activation; if
    // any step fails the pending account is rolled back (see finishSignup).
    await this.finishSignup(user, versions, 'signup_email', registerDto);

    await this.sendConfirmationEmail(user);
    return this.startSession(user);
  }

  /**
   * Finishes the sign-up of an account this request just created `pending`: writes its consent
   * records, then activates it with ONE conditional update (`UsersService.activateAccount`). Until
   * that update the account authenticates nothing (every sign-in path treats `pending` as not
   * active, `isAccountActive`), so no session, link or favourite can exist for it, however a
   * concurrent request interleaves. When a step fails the account is deleted, and only while it is
   * still `pending` (`discardUnfinishedSignup`): an account must not exist without its acceptance
   * (BR-010-01), nothing was issued for it, and the address is free to try again. The deletion is
   * the undo of a failed creation, not an AR-31 deletion of a person's data. When even the deletion
   * fails the account stays `pending`, still unable to sign in, and the next sign-up for the
   * address replaces it once it is older than the abandonment window. The log names the kind of
   * failure only (SC-15). For Google the one-time code is already spent: the person signs in with
   * Google again and is asked again.
   */
  private async finishSignup(
    account: UserAccount,
    versions: AcceptedVersions,
    method: Extract<AcceptanceMethod, 'signup_email' | 'signup_google'>,
    input: SignupConsentInput,
  ): Promise<void> {
    let step = 'Sign-up consent records could not be written';
    try {
      await this.recordSignupConsents(idOf(account), versions, method, input);
      step = 'Sign-up activation could not be completed';
      if (!(await this.usersService.activateAccount(idOf(account)))) {
        throw new Error('The pending account was not found');
      }
    } catch (error) {
      let rolledBack = false;
      try {
        rolledBack = await this.usersService.discardUnfinishedSignup(idOf(account));
      } catch {
        // Reported below with the original failure; the original error is what is rethrown.
      }
      this.logger.error(
        `${step} (${error instanceof Error ? error.name : 'error'}); ` +
          `account ${rolledBack ? 'rolled back' : 'NOT rolled back'}`,
      );
      throw error;
    }
  }

  /**
   * BR-010-03: the acceptance of the terms and the privacy policy, and BR-010-27: the WhatsApp
   * checkbox (an answer either way; it never stops the account from existing).
   */
  private async recordSignupConsents(
    userId: string,
    versions: AcceptedVersions,
    method: Extract<AcceptanceMethod, 'signup_email' | 'signup_google'>,
    input: SignupConsentInput,
  ): Promise<void> {
    await this.consents.recordAcceptance(userId, versions, method);
    await this.whatsappConsent.recordAtSignup(userId, input.whatsappConsent === true);
  }

  async login(loginDto: LoginDto, ip: string): Promise<AuthResult> {
    const email = normalizeEmail(loginDto.email);
    // BR-001-15: the attempt is counted, atomically, before the password is looked at, so parallel
    // guesses cannot all reach the comparison; over the limit it is refused even with the right
    // password.
    const reservation = await this.loginAttempts.reserve(email, ip);

    const account = await this.usersService.verifyPassword(email, loginDto.password);
    if (!account) {
      // BR-001-14: unknown email and wrong password are one answer. The count the attempt reserved
      // stays: nothing more to record.
      throw new DomainError('INVALID_CREDENTIALS');
    }
    if (!isAccountActive(account)) {
      // SPEC-009 BR-009-20: AFTER valid credentials, a deactivated account is told so (the support
      // address is the frontend's to show); closed and pending keep today's answer (BR-001-16). The
      // reserved attempt stays too, so this answer is not a free way to test passwords (SC-04): the
      // limit counts it like any other attempt.
      throw new DomainError(
        account.status === 'deactivated' ? 'ACCOUNT_DEACTIVATED' : 'INVALID_CREDENTIALS',
      );
    }
    const user = account;

    await this.loginAttempts.recordSuccess(email, ip, reservation);

    // DL-001-02: `user` is the document whose password was just verified; the session is bound to
    // its credential version, so a reset or any other credential change that completed after the
    // comparison leaves this session refused.
    return this.startSession(user);
  }

  /**
   * The return from Google (the callback): applies the Google sign-in rules and answers with a
   * one-time code for the frontend, never a session (BR-001-20). The code is a `google_exchange`
   * for an account that exists (60 s) or a `google_signup` for a person who must still accept the
   * terms (15 min); `exchangeGoogleCode` tells them apart.
   */
  async beginGoogleSignIn(identity: GoogleIdentity): Promise<string> {
    // BR-001-08: Google must vouch for the address, whatever else is true of the account.
    if (!identity.emailVerified) {
      throw new DomainError('GOOGLE_EMAIL_NOT_VERIFIED');
    }
    const account = await this.resolveGoogleAccount(identity);
    if (account) {
      return this.accountTokens.issue(idOf(account), 'google_exchange');
    }
    // BR-001-09, BR-010-01: no account exists until the terms are accepted, and nothing but this
    // short-lived record of what Google said is stored meanwhile.
    return this.accountTokens.issueGoogleSignup({
      googleId: identity.googleId,
      email: normalizeEmail(identity.email),
      name: identity.name,
    });
  }

  /**
   * The return from Google of a RE-AUTHENTICATION (SPEC-010 BR-010-13, the state cookie's intent
   * `reauth`): the person already has an account and only proves, again, that the Google identity
   * on it is theirs before an irreversible step. It answers the same one-time `google_exchange`
   * code, which `reauthenticate` spends for exactly that account; it never starts a session and
   * never creates, links or changes anything: an identity that is not already linked to an active
   * account is GOOGLE_SIGN_IN_FAILED, with no sign-up record left behind.
   */
  async beginGoogleReauthentication(identity: GoogleIdentity): Promise<string> {
    if (!identity.emailVerified) {
      throw new DomainError('GOOGLE_EMAIL_NOT_VERIFIED');
    }
    const account = await this.usersService.findByGoogleId(identity.googleId);
    if (!account || !isAccountActive(account)) {
      throw new DomainError('GOOGLE_SIGN_IN_FAILED');
    }
    return this.accountTokens.issue(idOf(account), 'google_exchange');
  }

  /**
   * POST /auth/google/exchange: trades the code of the redirect for a session, or says the terms
   * must be accepted first. An existing account's code is spent here (single use, BR-001-20); a
   * signup code is only looked at, because `completeGoogleSignup` spends it.
   */
  async exchangeGoogleCode(code: string): Promise<GoogleExchangeResult> {
    const record = await this.accountTokens.consume(code, 'google_exchange');
    if (record) {
      const user = await this.usersService.findById(record.userId);
      // BR-001-16: closed or deactivated between the redirect and the exchange; a deactivated
      // account is told so (SPEC-009 BR-009-20), as at the callback.
      if (!user || !isAccountActive(user)) {
        throw new DomainError(inactiveGoogleCode(user));
      }
      return { status: 'signed_in', ...(await this.startSession(user)) };
    }
    const signup = await this.accountTokens.peekGoogleSignup(code);
    if (signup) {
      return { status: 'terms_required', email: signup.email, name: signup.name };
    }
    throw new DomainError('INVALID_GOOGLE_CODE');
  }

  /**
   * POST /auth/google/complete: the person accepted the terms (the DTO requires `true`). The code
   * is spent atomically, then the account is created: searcher only, email already confirmed, no
   * password (BR-001-03, BR-001-09), and the acceptance is recorded with it (BR-010-03,
   * `signup_google`). The versions are checked BEFORE the code is spent, so a stale screen keeps
   * the pending sign-up (TERMS_VERSION_OUTDATED, 409) and nothing is stored.
   */
  async completeGoogleSignup(code: string, consent: SignupConsentInput = {}): Promise<AuthResult> {
    const versions = this.consents.resolveVersions({
      terms: consent.termsVersion,
      privacy: consent.privacyVersion,
    });
    const profile = await this.accountTokens.consumeGoogleSignup(code);
    if (!profile) {
      throw new DomainError('INVALID_GOOGLE_CODE');
    }
    const identity: GoogleIdentity = { ...profile, emailVerified: true };

    // Someone may have registered this email, or linked this Google identity, since the redirect:
    // that is then simply the sign-in of an existing account, with the same rules.
    let account = await this.resolveGoogleAccount(identity);
    if (!account) {
      try {
        account = await this.usersService.createGoogleAccount(profile, this.clock.now());
      } catch (error) {
        if (!(error instanceof DomainError) || error.code !== 'EMAIL_ALREADY_REGISTERED') {
          throw error;
        }
        account = await this.resolveGoogleAccount(identity);
        if (!account) throw error;
        // Not created by this request: the account's own sign-up recorded its acceptance.
        return this.startSession(account);
      }
      // BR-010-03, BR-010-27: only an account this request created records the acceptance and
      // activates it (it was created `pending`, BR-010-01).
      await this.finishSignup(account, versions, 'signup_google', consent);
    }
    return this.startSession(account);
  }

  /** POST /auth/google/cancel: declining leaves no stored personal data (BR-010-01). */
  async cancelGoogleSignup(code: string): Promise<void> {
    await this.accountTokens.discardGoogleSignup(code);
  }

  /**
   * The existing account a verified Google identity signs in to, or null when there is none:
   * matched by Google's permanent id first (BR-001-11), then by email, linking Google (BR-001-10).
   * An account that is not active (pending, deactivated or closed) is refused by any route
   * (BR-001-16, SPEC-010 BR-010-01).
   */
  private async resolveGoogleAccount(identity: GoogleIdentity): Promise<UserAccount | null> {
    // SPEC-010 BR-010-01: a `pending` account older than the abandonment window is a sign-up that
    // never finished; it must not make this person's Google sign-in fail for ever. A younger one
    // is a sign-up still in flight: it falls through to the refusal below like any inactive account.
    await this.usersService.discardAbandonedPending(
      { email: identity.email, googleId: identity.googleId },
      this.clock.now(),
    );
    const linked = await this.usersService.findByGoogleId(identity.googleId);
    if (linked) {
      if (!isAccountActive(linked)) {
        throw new DomainError(inactiveGoogleCode(linked));
      }
      return linked;
    }

    const existing = await this.usersService.findByEmail(identity.email);
    if (!existing) return null;

    const userId = idOf(existing);
    const outcome = await this.usersService.linkGoogleIdentity(
      userId,
      identity.googleId,
      this.clock.now(),
    );
    if (outcome.result !== 'linked_confirmed' && outcome.result !== 'linked_unconfirmed') {
      // Not active (BR-001-16; a deactivated one is told so, SPEC-009 BR-009-20), another Google
      // identity already linked (BR-001-11), or gone. Google vouched for the address, so naming the
      // deactivation here shows it to the address's owner only.
      throw new DomainError(
        outcome.result === 'inactive' ? inactiveGoogleCode(existing) : 'GOOGLE_SIGN_IN_FAILED',
      );
    }
    if (outcome.result === 'linked_unconfirmed') {
      // DL-001-02: the email was never confirmed, so whoever set the password never proved they
      // own it. The same update that deleted the password also moved the credential version, so
      // every session issued for the old credential is already refused (JwtStrategy), including
      // one a sign-in that had passed the password check opens after this point. Revoking them
      // and the outstanding links is the tidy-up on top; each step is idempotent and both are
      // attempted even when one fails, so the failure is reported only after neither was skipped.
      await this.endTakenOverCredentials(userId);
    }
    return outcome.account;
  }

  private async endTakenOverCredentials(userId: string): Promise<void> {
    const steps = [
      this.sessions.revokeAllForUser(userId),
      this.accountTokens.revokeAllUnused(userId),
    ];
    const results = await Promise.allSettled(steps);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) {
      // SC-15: kind of failure only, never the provider's message.
      this.logger.warn(
        `Google link clean-up incomplete (${failed.reason instanceof Error ? failed.reason.name : 'error'})`,
      );
      throw failed.reason;
    }
  }

  /**
   * SPEC-010 BR-010-13: proves again that whoever holds the session is the account holder, before
   * the account is closed. Two ways, as at sign-in:
   *
   * - the current password, counted like a sign-in attempt (SC-04: a stolen session must not guess
   *   it at bcrypt speed; the attempt is reserved first, a wrong password keeps it and is refused
   *   with CURRENT_PASSWORD_INCORRECT, past 10 in 15 minutes TOO_MANY_ATTEMPTS);
   * - a fresh `google_exchange` code (60 s, single use) that the Google callback issued for an
   *   existing account: it is spent atomically and only if it belongs to THIS account; unknown,
   *   used, expired or another account's code is the same INVALID_GOOGLE_CODE, and another
   *   account's code is left unspent.
   *
   * An account that cannot offer the proof asked for is refused with a stable code: a Google-only
   * account asked for a password is OAUTH_ACCOUNT_HAS_NO_PASSWORD; one with neither is
   * REAUTHENTICATION_UNAVAILABLE. Nothing is written beyond the attempt counters and the spent code.
   *
   * It answers the CREDENTIAL VERSION the proof was given for (DL-001-02), so the irreversible write
   * that follows can be fenced on it: for the password, the version of the document whose hash was
   * compared (the comparison takes time, and a reset or a Google takeover can land meanwhile); for
   * the Google code, the account's version read right after the code was spent. A closure that
   * carries a version the account no longer has closes nothing (`UsersService.closeAccount`).
   */
  async reauthenticate(
    userId: string,
    proof: ReauthenticationProof,
    ip: string,
  ): Promise<{ readonly credentialVersion: number }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }
    const providers = Array.from(user.providers ?? []);
    const hasPassword = providers.includes('local');
    const hasGoogle = providers.includes('google');
    if (!hasPassword && !hasGoogle) {
      throw new DomainError('REAUTHENTICATION_UNAVAILABLE');
    }

    if (proof.googleCode !== undefined) {
      if (!(await this.accountTokens.consume(proof.googleCode, 'google_exchange', userId))) {
        throw new DomainError('INVALID_GOOGLE_CODE');
      }
      // The version at the moment the code is spent for this account (read after, never before:
      // a takeover that completed before the code was spent is part of what was proven).
      const spentFor = await this.usersService.findById(userId);
      if (!spentFor) throw new DomainError('USER_NOT_FOUND');
      return { credentialVersion: credentialVersionOf(spentFor) };
    }

    if (!hasPassword) {
      throw new DomainError('OAUTH_ACCOUNT_HAS_NO_PASSWORD');
    }
    const reservation = await this.loginAttempts.reserve(user.email, ip);
    const verified = await this.usersService.validatePassword(user.email, proof.password);
    if (!verified) {
      throw new DomainError('CURRENT_PASSWORD_INCORRECT');
    }
    await this.loginAttempts.recordSuccess(user.email, ip, reservation);
    // `verified` is the document whose hash matched: its version is the credential that was proven.
    return { credentialVersion: credentialVersionOf(verified) };
  }

  /**
   * SPEC-010 BR-010-14: after an account was closed, ends every session it has and every one-time
   * link it still holds (confirmation, recovery, Google exchange). Idempotent; both steps are
   * attempted even if one fails, then the first failure is rethrown. A session the account still
   * had would be refused anyway (the account is no longer active, and its credential version moved
   * with the closure): this is the tidy-up on top.
   */
  async endAllSessionsAndLinks(userId: string): Promise<void> {
    const results = await Promise.allSettled([
      this.sessions.revokeAllForUser(userId),
      this.accountTokens.revokeAllUnused(userId),
    ]);
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed) throw failed.reason;
  }

  /** BR-001-18: sign-out ends this session on the server, so a copy of the token stops working. */
  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    // BR-001-21: the same visible response whether or not an account exists, and no email unless
    // one does. A deactivated or closed account is treated as absent (BR-001-16).
    if (!user || !isAccountActive(user)) return;

    // Everything after the lookup runs detached: the token's writes and the real send would
    // otherwise tell a known address from an unknown one by their delay (SC-05). A failure is
    // logged by kind only (SC-15). BR-001-24: works for Google-only accounts too. BR-001-22: the
    // new token replaces older ones.
    this.detach('Password reset email', async () => {
      const token = await this.accountTokens.issue(user._id.toString(), 'account_recovery');
      await this.emailService.sendPasswordResetEmail(user.email, token, user.name);
    });
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    // BR-001-22: single use, 1 hour; unknown, used and expired are the same answer.
    const record = await this.accountTokens.consume(token, 'account_recovery');
    if (!record) {
      throw new DomainError('INVALID_RESET_TOKEN');
    }

    // SPEC-010 BR-010-14: a link that outlived the account (spent after its closure, or issued by a
    // request that raced it) rewrites nothing: the answer is the generic invalid-token one, and the
    // write itself is conditional on the account being active, so a closure between this check and
    // the write cannot be overtaken either.
    const holder = await this.usersService.findById(record.userId);
    if (!holder || (holder.status ?? 'active') !== 'active') {
      throw new DomainError('INVALID_RESET_TOKEN');
    }

    // BR-001-24: finishing recovery adds email-and-password sign-in to a Google-only account.
    try {
      await this.usersService.setPassword(record.userId, newPassword);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'USER_NOT_FOUND') {
        throw new DomainError('INVALID_RESET_TOKEN');
      }
      throw error;
    }
    // BR-001-22: a successful reset kills every outstanding recovery link.
    await this.accountTokens.revokeUnused(record.userId, 'account_recovery');
    // BR-001-19: and every session; the reset does not sign anyone in.
    await this.sessions.revokeAllForUser(record.userId);
  }

  async updateProfile(userId: string, updateData: UpdateProfileDto): Promise<UserProfile> {
    // BR-001-26 / D-63: the email cannot be changed. The profile form still sends it back with the
    // name, so the current address is accepted as a no-op and any other is refused as a whole,
    // before anything is written (BR-001-29).
    if (typeof updateData.email === 'string') {
      const current = await this.usersService.findById(userId);
      if (!current) {
        throw new DomainError('USER_NOT_FOUND');
      }
      if (normalizeEmail(current.email) !== normalizeEmail(updateData.email)) {
        throw new DomainError('EMAIL_CHANGE_UNAVAILABLE');
      }
    }
    // BR-001-25 / BR-001-31: only name and phone are handed on.
    const user = await this.usersService.updateProfile(userId, {
      name: updateData.name,
      phone: updateData.phone,
    });
    return this.toUserProfile(user);
  }

  async getFullProfile(userId: string): Promise<UserProfile> {
    const user = await this.usersService.findByIdFull(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }
    return this.toUserProfile(user);
  }

  async changePassword(
    userId: string,
    sessionId: string,
    currentPassword: string,
    newPassword: string,
    ip: string,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    if (!user.providers?.includes('local')) {
      throw new DomainError('OAUTH_ACCOUNT_HAS_NO_PASSWORD');
    }

    // SC-04: a stolen session must not be able to guess the current password at bcrypt speed, so
    // this check shares sign-in's counters: the attempt is reserved first, a wrong password keeps
    // it, a right one gives it back.
    const reservation = await this.loginAttempts.reserve(user.email, ip);

    const verified = await this.usersService.validatePassword(user.email, currentPassword);
    if (!verified) {
      throw new DomainError('CURRENT_PASSWORD_INCORRECT');
    }
    await this.loginAttempts.recordSuccess(user.email, ip, reservation);

    // DL-001-02: the write applies only while the account still has the credential version the
    // current password was verified against; if a reset or another change got in between, nothing
    // is written and the answer is UNAUTHENTICATED. It bumps the version in the same write.
    const updated = await this.usersService.changePassword(
      userId,
      newPassword,
      credentialVersionOf(verified),
    );
    await this.endOtherSessions(userId, sessionId, updated);
  }

  async setPassword(userId: string, sessionId: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }
    if (user.providers?.includes('local')) {
      throw new DomainError('PASSWORD_ALREADY_SET');
    }
    // DL-001-02: fenced on the version read together with "no local provider", so a credential
    // change in between (a recovery that already added a password) cannot be overwritten.
    const updated = await this.usersService.setPassword(
      userId,
      newPassword,
      credentialVersionOf(user),
    );
    await this.endOtherSessions(userId, sessionId, updated);
  }

  /**
   * BR-001-19, DL-001-02: after the holder changes their own credential, the session that did it
   * is bound to the new version and stays; every other session is revoked (and, being stamped with
   * the old version, is refused anyway should the revocation fail).
   */
  private async endOtherSessions(
    userId: string,
    sessionId: string,
    updated: UserAccount,
  ): Promise<void> {
    await this.sessions.rebind(sessionId, userId, credentialVersionOf(updated));
    await this.sessions.revokeAllForUser(userId, sessionId);
  }

  /**
   * BR-001-17/18: opens a server-side session and signs a token that only points at it. The token
   * carries `sub` and `jti`; no email, name, role or plan (those are read per request).
   *
   * DL-001-02: the session records the credential version of `user`, so `user` must be the
   * document that proved the credential (the one `validatePassword` checked, the account the
   * exchange or the Google flow just read), never a later fetch: a credential takeover in between
   * then leaves this session with the old version, and the next request refuses it.
   */
  async startSession(user: UserAccount): Promise<AuthResult> {
    const userId = idOf(user);
    const jti = await this.sessions.create(userId, credentialVersionOf(user));
    const payload: JwtPayload = { sub: userId, jti };
    return {
      accessToken: this.jwtService.sign(payload),
      user: this.toUserProfile(user),
    };
  }

  /** BR-001-05, BR-001-23: a fresh 24-hour link replaces any earlier one. */
  private async sendConfirmationEmail(user: UserAccount): Promise<void> {
    const userId = typeof user._id === 'string' ? user._id : user._id.toHexString();
    // Bound to the address it goes to: see verifyEmail.
    const token = await this.accountTokens.issue(userId, 'email_confirmation', {
      newEmail: user.email,
    });
    await this.deliver('Verification email', () =>
      this.emailService.sendVerificationEmail(user.email, token, user.name),
    );
  }

  /**
   * Runs mail work (token writes and the send) without making the request wait for it, so the
   * answer to a recovery request takes the same time for every address (SC-05). It is tracked, so
   * shutdown and tests can wait for it with `flushDeliveries`.
   */
  private detach(kind: string, task: () => Promise<void>): void {
    const run = this.deliver(kind, task);
    this.inFlight.add(run);
    void run.finally(() => this.inFlight.delete(run));
  }

  /** Resolves once the mail work started so far has finished; it never rejects (see `deliver`). */
  async flushDeliveries(): Promise<void> {
    await Promise.all([...this.inFlight]);
  }

  async beforeApplicationShutdown(): Promise<void> {
    await this.flushDeliveries(); // do not drop a recovery mail that is on its way out
  }

  /**
   * An account stays usable when the mail provider is down: the person can ask for another link
   * (BR-001-06). SC-15: the log line names the kind of mail and the error class, never the
   * address, the link or the provider's message (which can quote the recipient).
   */
  private async deliver(kind: string, send: () => Promise<void>): Promise<void> {
    try {
      await send();
    } catch (error) {
      this.logger.warn(
        `${kind} could not be sent (${error instanceof Error ? error.name : 'error'})`,
      );
    }
  }

  async verifyEmail(token: string): Promise<void> {
    // BR-001-05: single use, 24 hours; unknown, used, expired and replaced links answer alike.
    const record = await this.accountTokens.consume(token, 'email_confirmation');
    if (!record) {
      throw new DomainError('INVALID_VERIFICATION_TOKEN');
    }
    // The link confirms the address it was mailed to, only while that is still the account's
    // address. The email is immutable (BR-001-26, D-63), so this is defence in depth against any
    // write path that would change it (BR-001-04).
    if (
      !record.newEmail ||
      !(await this.usersService.confirmEmail(record.userId, record.newEmail))
    ) {
      throw new DomainError('INVALID_VERIFICATION_TOKEN');
    }
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    if (!user.providers?.includes('local')) {
      throw new DomainError('OAUTH_ACCOUNT_NEEDS_NO_VERIFICATION');
    }

    if (user.emailVerified) {
      throw new DomainError('EMAIL_ALREADY_VERIFIED');
    }

    // BR-001-05/06: a new link makes the earlier unused ones stop working.
    await this.sendConfirmationEmail(user);
  }

  async getVerificationStatus(
    userId: string,
  ): Promise<{ emailVerified: boolean; providers: string[] }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }
    return {
      emailVerified: user.emailVerified ?? false,
      providers: Array.from(user.providers),
    };
  }

  private toUserProfile(user: UserAccount): UserProfile {
    // AR-09 / SC-01: return detached public values, never hydrated document internals.
    return {
      _id: typeof user._id === 'string' ? user._id : user._id.toHexString(),
      email: user.email,
      name: user.name,
      providers: Array.from(user.providers),
      emailVerified: user.emailVerified ?? false,
      role: user.role ?? 'free',
      subscriptionStatus: user.subscriptionStatus ?? null,
      // SPEC-002 DL-002-05: the capability as stored; a missing flag is false (AR-28).
      isAdmin: user.isAdmin === true,
      phone: user.phone,
      createdAt: new Date(user.createdAt),
      updatedAt: new Date(user.updatedAt),
    };
  }
}
