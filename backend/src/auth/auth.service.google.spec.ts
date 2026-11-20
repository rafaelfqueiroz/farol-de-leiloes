// SPEC-001 Google sign-in rules (BR-001-03, -08, -09, -10, -11, -16, -20, DL-001-02, SPEC-010
// BR-010-01) in AuthService, against hand-written fakes of the users, the token and the session
// stores and a fake clock (TS-03, TS-06). The conditional update behind the link is held against
// MongoDB in test/integration/auth-google.spec.ts (TS-02).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
import { DomainError } from '../common/errors/domain-error.js';
import type { EmailService } from '../email/email.service.js';
import type { UsersService } from '../users/users.service.js';
import type { GoogleIdentity } from './google/google-identity.js';
import { AccountTokenService } from './tokens/account-token.service.js';
import type { AccountTokenRepository } from './tokens/account-token.repository.js';
import { SessionsService } from './sessions/sessions.service.js';
import type { SessionsRepository } from './sessions/sessions.repository.js';
import { LoginAttemptsService } from './login-attempts/login-attempts.service.js';
import type { LoginAttemptsRepository } from './login-attempts/login-attempts.repository.js';
import { FakeClock, MINUTE, SECOND } from '../../test/fakes/fake-clock.js';
import {
  FakeAccountTokenRepository,
  FakeLoginAttemptsRepository,
  FakeSessionsRepository,
} from '../../test/fakes/fake-auth-repositories.js';
import { FakeUsersService, type FakeAccount } from '../../test/fakes/fake-users-service.js';
import { wirePrivacy } from '../../test/support/privacy-services.js';

const CREATED = new Date('2026-01-01T12:00:00.000Z');

function build() {
  const users = new FakeUsersService();
  const clock = new FakeClock();
  const tokenRepo = new FakeAccountTokenRepository();
  const sessionRepo = new FakeSessionsRepository();
  const sign = vi
    .fn()
    .mockImplementation((payload: { sub: string; jti: string }) => `jwt:${payload.sub}`);
  const privacy = wirePrivacy(clock, users as unknown as UsersService);
  const service = new AuthService(
    users as unknown as UsersService,
    { sign } as unknown as JwtService,
    {} as EmailService,
    new AccountTokenService(tokenRepo as unknown as AccountTokenRepository, clock),
    new SessionsService(sessionRepo as unknown as SessionsRepository, clock),
    new LoginAttemptsService(
      new FakeLoginAttemptsRepository() as unknown as LoginAttemptsRepository,
      clock,
    ),
    privacy.consents,
    privacy.whatsapp,
    clock,
  );
  const tokens = new AccountTokenService(tokenRepo as unknown as AccountTokenRepository, clock);
  return { service, users, clock, tokenRepo, sessionRepo, tokens, privacy };
}

const identity = (overrides: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  googleId: 'g-1',
  email: 'ana@example.test',
  emailVerified: true,
  name: 'Ana Teste',
  ...overrides,
});

function account(overrides: Partial<FakeAccount> = {}): FakeAccount {
  return {
    _id: '64b000000000000000000001',
    email: 'ana@example.test',
    name: 'Ana',
    providers: ['local'],
    emailVerified: true,
    password: 'the-password',
    createdAt: CREATED,
    updatedAt: CREATED,
    ...overrides,
  };
}

let ctx: ReturnType<typeof build>;
beforeEach(() => {
  ctx = build();
});

describe('AuthService.beginGoogleSignIn (BR-001-08)', () => {
  it('refuses an email Google does not report as verified, creating nothing', async () => {
    await expect(ctx.service.beginGoogleSignIn(identity({ emailVerified: false }))).rejects.toEqual(
      new DomainError('GOOGLE_EMAIL_NOT_VERIFIED'),
    );

    expect(ctx.users.accounts.size).toBe(0);
    expect(ctx.tokenRepo.stored).toEqual([]);
  });

  it('refuses an unverified email even when the Google identity already has an account', async () => {
    ctx.users.seed(account({ googleId: 'g-1', providers: ['google'] }));

    await expect(ctx.service.beginGoogleSignIn(identity({ emailVerified: false }))).rejects.toEqual(
      new DomainError('GOOGLE_EMAIL_NOT_VERIFIED'),
    );
    expect(ctx.tokenRepo.stored).toEqual([]);
  });

  it('BR-001-09, BR-010-01: an email with no account gets a 15-minute signup code, and no account', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity({ email: ' Ana@Example.TEST ' }));

    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(ctx.users.accounts.size).toBe(0);
    expect(ctx.tokenRepo.stored).toHaveLength(1);
    expect(ctx.tokenRepo.stored[0]).toMatchObject({
      purpose: 'google_signup',
      profile: { googleId: 'g-1', email: 'ana@example.test', name: 'Ana Teste' },
      expiresAt: new Date(ctx.clock.now().getTime() + 15 * MINUTE),
    });
  });

  it('BR-001-20: an existing account gets a 60-second exchange code, never a session', async () => {
    ctx.users.seed(account());

    const code = await ctx.service.beginGoogleSignIn(identity());

    expect(ctx.tokenRepo.stored.map((t) => t.purpose)).toEqual(['google_exchange']);
    expect(ctx.tokenRepo.stored[0]?.expiresAt).toEqual(
      new Date(ctx.clock.now().getTime() + 60 * SECOND),
    );
    expect(ctx.sessionRepo.stored).toEqual([]);
    expect(code).not.toContain('jwt:');
  });
});

describe('Google linking decision table (BR-001-10, BR-001-11, BR-001-16, DL-001-02)', () => {
  it('BR-001-10: a confirmed account is linked and keeps its password and local provider', async () => {
    const existing = ctx.users.seed(account());
    await ctx.service.beginGoogleSignIn(identity());

    expect(existing).toMatchObject({
      googleId: 'g-1',
      emailVerified: true,
      password: 'the-password',
      providers: ['local', 'google'],
    });
  });

  it('BR-001-10, DL-001-02: an unconfirmed account is confirmed, loses its password and local provider, sessions and links', async () => {
    const existing = ctx.users.seed(account({ emailVerified: false }));
    const id = '64b000000000000000000001';
    const jti = await new SessionsService(
      ctx.sessionRepo as unknown as SessionsRepository,
      ctx.clock,
    ).create(id, 0);
    const confirmation = await ctx.tokens.issue(id, 'email_confirmation');
    const recovery = await ctx.tokens.issue(id, 'account_recovery');

    await ctx.service.beginGoogleSignIn(identity());

    expect(existing.emailVerified).toBe(true);
    expect(existing.password).toBeUndefined();
    expect(existing.providers).toEqual(['google']);
    expect(ctx.sessionRepo.stored.find((s) => s.id === jti)?.revokedAt).toBeDefined();
    await expect(ctx.tokens.consume(confirmation, 'email_confirmation')).resolves.toBeNull();
    await expect(ctx.tokens.consume(recovery, 'account_recovery')).resolves.toBeNull();
  });

  it('a confirmed account keeps its sessions and links when Google is linked', async () => {
    ctx.users.seed(account());
    const id = '64b000000000000000000001';
    const sessions = new SessionsService(
      ctx.sessionRepo as unknown as SessionsRepository,
      ctx.clock,
    );
    const jti = await sessions.create(id, 0);
    const recovery = await ctx.tokens.issue(id, 'account_recovery');

    await ctx.service.beginGoogleSignIn(identity());

    await expect(sessions.isActive(jti, id)).resolves.toBe(true);
    await expect(ctx.tokens.consume(recovery, 'account_recovery')).resolves.not.toBeNull();
  });

  it('DL-001-02: taking over an unconfirmed account moves its credential version from 0 to 1; a confirmed link leaves it', async () => {
    const takenOver = ctx.users.seed(account({ emailVerified: false }));
    const kept = ctx.users.seed(
      account({
        _id: '64b000000000000000000002',
        email: 'bia@example.test',
        credentialVersion: 4,
      }),
    );

    await ctx.service.beginGoogleSignIn(identity());
    await ctx.service.beginGoogleSignIn(identity({ googleId: 'g-2', email: 'bia@example.test' }));

    expect(takenOver.credentialVersion).toBe(1);
    expect(kept.credentialVersion).toBe(4);
  });

  it('DL-001-02: a session opened from a document read before the takeover carries the old version; the exchange afterwards carries the new one', async () => {
    const existing = ctx.users.seed(account({ emailVerified: false }));
    const id = '64b000000000000000000001';
    // The sign-in that already passed the password check holds this snapshot.
    const validatedBeforeLink = { ...existing };

    const code = await ctx.service.beginGoogleSignIn(identity());
    await ctx.service.startSession(validatedBeforeLink);
    await ctx.service.exchangeGoogleCode(code);

    const versions = ctx.sessionRepo.stored
      .filter((s) => s.userId === id)
      .map((s) => s.credentialVersion);
    expect(versions).toEqual([0, 1]);
    expect(existing.credentialVersion).toBe(1);
  });

  it('DL-001-02: both clean-up steps are attempted when one fails, the failure is surfaced, and a retry sees the account already linked', async () => {
    ctx.users.seed(account({ emailVerified: false }));
    const revokeSessions = vi
      .spyOn(SessionsService.prototype, 'revokeAllForUser')
      .mockRejectedValueOnce(new Error('write failed'));
    const revokeTokens = vi.spyOn(AccountTokenService.prototype, 'revokeAllUnused');

    await expect(ctx.service.beginGoogleSignIn(identity())).rejects.toThrow('write failed');

    expect(revokeSessions).toHaveBeenCalledTimes(1);
    expect(revokeTokens).toHaveBeenCalledTimes(1);
    // The credential version moved with the link, so the retry (linked by Google id) is safe.
    await expect(ctx.service.beginGoogleSignIn(identity())).resolves.toMatch(/^[0-9a-f]{64}$/);
    vi.restoreAllMocks();
  });

  it('BR-001-11: an account already linked is found by Google id even when the email differs', async () => {
    ctx.users.seed(account({ email: 'old@example.test', googleId: 'g-1', providers: ['google'] }));

    const code = await ctx.service.beginGoogleSignIn(identity({ email: 'new@example.test' }));

    const result = await ctx.service.exchangeGoogleCode(code);
    expect(result).toMatchObject({ status: 'signed_in', user: { email: 'old@example.test' } });
    expect(ctx.users.accounts.size).toBe(1);
  });

  it('BR-001-11: an email whose account is linked to another Google identity is refused, not re-linked', async () => {
    const existing = ctx.users.seed(account({ googleId: 'g-other', providers: ['google'] }));

    await expect(ctx.service.beginGoogleSignIn(identity())).rejects.toEqual(
      new DomainError('GOOGLE_SIGN_IN_FAILED'),
    );
    expect(existing.googleId).toBe('g-other');
  });

  it.each(['deactivated', 'closed'] as const)(
    'BR-001-16: an account %s is refused by email, and its sessions and password stay untouched',
    async (status) => {
      const existing = ctx.users.seed(account({ status, emailVerified: false }));

      await expect(ctx.service.beginGoogleSignIn(identity())).rejects.toEqual(
        new DomainError('GOOGLE_SIGN_IN_FAILED'),
      );
      expect(existing).toMatchObject({ password: 'the-password', providers: ['local'] });
      expect(existing.googleId).toBeUndefined();
    },
  );

  it('BR-001-16: an inactive account already linked to this Google identity is refused', async () => {
    ctx.users.seed(account({ googleId: 'g-1', providers: ['google'], status: 'deactivated' }));

    await expect(ctx.service.beginGoogleSignIn(identity())).rejects.toEqual(
      new DomainError('GOOGLE_SIGN_IN_FAILED'),
    );
  });
});

describe('AuthService.exchangeGoogleCode (BR-001-20, BR-001-09)', () => {
  it('turns an existing account code into a session, like a login, exactly once', async () => {
    ctx.users.seed(account());
    const code = await ctx.service.beginGoogleSignIn(identity());

    const result = await ctx.service.exchangeGoogleCode(code);

    expect(result).toMatchObject({
      status: 'signed_in',
      accessToken: 'jwt:64b000000000000000000001',
      user: { email: 'ana@example.test', role: 'free', providers: ['local', 'google'] },
    });
    expect(ctx.sessionRepo.stored).toHaveLength(1);
    await expect(ctx.service.exchangeGoogleCode(code)).rejects.toEqual(
      new DomainError('INVALID_GOOGLE_CODE'),
    );
    expect(ctx.sessionRepo.stored).toHaveLength(1);
  });

  it('an exchange code stops working after 60 seconds', async () => {
    ctx.users.seed(account());
    const code = await ctx.service.beginGoogleSignIn(identity());
    ctx.clock.advance(61 * SECOND);

    await expect(ctx.service.exchangeGoogleCode(code)).rejects.toEqual(
      new DomainError('INVALID_GOOGLE_CODE'),
    );
  });

  it('an exchange code works at 59 seconds', async () => {
    ctx.users.seed(account());
    const code = await ctx.service.beginGoogleSignIn(identity());
    ctx.clock.advance(59 * SECOND);

    await expect(ctx.service.exchangeGoogleCode(code)).resolves.toMatchObject({
      status: 'signed_in',
    });
  });

  it('BR-001-16: an account deactivated after the redirect gets no session', async () => {
    const existing = ctx.users.seed(account());
    const code = await ctx.service.beginGoogleSignIn(identity());
    existing.status = 'closed';

    await expect(ctx.service.exchangeGoogleCode(code)).rejects.toEqual(
      new DomainError('GOOGLE_SIGN_IN_FAILED'),
    );
    expect(ctx.sessionRepo.stored).toEqual([]);
  });

  it('BR-001-09: a signup code answers terms_required with email and name, and spends nothing', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());

    const first = await ctx.service.exchangeGoogleCode(code);
    const second = await ctx.service.exchangeGoogleCode(code);

    expect(first).toEqual({
      status: 'terms_required',
      email: 'ana@example.test',
      name: 'Ana Teste',
    });
    expect(second).toEqual(first);
    expect(ctx.users.accounts.size).toBe(0);
    expect(ctx.sessionRepo.stored).toEqual([]);
  });

  it.each(['', 'unknown-code', 'z'.repeat(64)])(
    'refuses %j as INVALID_GOOGLE_CODE',
    async (code) => {
      await expect(ctx.service.exchangeGoogleCode(code)).rejects.toEqual(
        new DomainError('INVALID_GOOGLE_CODE'),
      );
    },
  );
});

describe('AuthService.completeGoogleSignup (BR-001-03, BR-001-09, SPEC-010 BR-010-01)', () => {
  it('creates a confirmed, password-less, Google-only account and opens a session', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());

    const result = await ctx.service.completeGoogleSignup(code);

    expect(ctx.users.accounts.size).toBe(1);
    const created = [...ctx.users.accounts.values()][0];
    expect(created).toMatchObject({
      email: 'ana@example.test',
      name: 'Ana Teste',
      googleId: 'g-1',
      providers: ['google'],
      emailVerified: true,
    });
    expect(created?.password).toBeUndefined();
    expect(result.user).toMatchObject({
      role: 'free',
      subscriptionStatus: null,
      providers: ['google'],
    });
    expect(result.accessToken).toMatch(/^jwt:/);
    expect(ctx.sessionRepo.stored).toHaveLength(1);
  });

  it('BR-010-03: records the acceptance with the account, by Google sign-up', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());

    await ctx.service.completeGoogleSignup(code);

    const id = [...ctx.users.accounts.keys()][0];
    expect(ctx.privacy.consentsRepo.rows.map((r) => [r.userId, r.documentType, r.method])).toEqual([
      [id, 'terms', 'signup_google'],
      [id, 'privacy', 'signup_google'],
    ]);
  });

  it('BR-010-27: records the WhatsApp checkbox either way, and the account exists all the same', async () => {
    const declined = await ctx.service.beginGoogleSignIn(identity({ googleId: 'g-1' }));
    await ctx.service.completeGoogleSignup(declined, {});
    const granted = await ctx.service.beginGoogleSignIn(
      identity({ googleId: 'g-2', email: 'bia@example.test' }),
    );
    await ctx.service.completeGoogleSignup(granted, { whatsappConsent: true });

    expect(ctx.users.accounts.size).toBe(2);
    expect(ctx.privacy.whatsappRepo.rows.map((r) => [r.action, r.method])).toEqual([
      ['declined', 'signup'],
      ['granted', 'signup'],
    ]);
  });

  it('BR-010-01: a stale version is TERMS_VERSION_OUTDATED, creates nothing and does NOT spend the code', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());

    await expect(ctx.service.completeGoogleSignup(code, { privacyVersion: '0.0' })).rejects.toEqual(
      new DomainError('TERMS_VERSION_OUTDATED', {
        documents: [
          { type: 'terms', version: '0.1' },
          { type: 'privacy', version: '0.1' },
        ],
      }),
    );

    expect(ctx.users.accounts.size).toBe(0);
    expect(ctx.privacy.consentsRepo.rows).toEqual([]);
    // The pending sign-up is still there: the person can accept the current version and finish.
    await expect(
      ctx.service.completeGoogleSignup(code, { privacyVersion: '0.1' }),
    ).resolves.toBeDefined();
    expect(ctx.users.accounts.size).toBe(1);
  });

  it('BR-010-01: when the acceptance cannot be written the new account is rolled back and the person can sign in again', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());
    ctx.privacy.consentsRepo.failInsertsWith = new Error('db down');

    await expect(ctx.service.completeGoogleSignup(code)).rejects.toThrow('db down');

    expect(ctx.users.accounts.size).toBe(0);
    expect(ctx.sessionRepo.stored).toEqual([]);
    // The code was spent with the attempt; a new Google sign-in gives a new one and completes.
    await expect(ctx.service.completeGoogleSignup(code)).rejects.toEqual(
      new DomainError('INVALID_GOOGLE_CODE'),
    );
    ctx.privacy.consentsRepo.failInsertsWith = undefined;
    const again = await ctx.service.beginGoogleSignIn(identity());
    await expect(ctx.service.completeGoogleSignup(again)).resolves.toBeDefined();
    expect(ctx.users.accounts.size).toBe(1);
    expect(ctx.privacy.consentsRepo.rows).toHaveLength(2);
  });

  it('DL-001-02, SPEC-010: taking over an unconfirmed account starts a new consent generation and asks the owner again', async () => {
    // The registrant (never confirmed the address) signed up and consented to WhatsApp.
    const registrant = ctx.users.seed(
      account({ emailVerified: false, whatsappPromptAnsweredAt: CREATED }),
    );
    const id = registrant._id as string;
    await ctx.privacy.consents.recordAcceptance(
      id,
      { terms: '0.1', privacy: '0.1' },
      'signup_email',
    );
    await ctx.privacy.whatsapp.record(id, 'granted', 'signup', null);
    const code = await ctx.service.beginGoogleSignIn(identity());

    await ctx.service.exchangeGoogleCode(code);

    const owner = ctx.users.accounts.get(id);
    expect(owner?.consentResetAt).toEqual(ctx.clock.now()); // the takeover instant, from the Clock
    expect(owner?.whatsappPromptAnsweredAt).toBeUndefined(); // the owner is asked once more
    expect(await ctx.privacy.consents.pendingFor(id, owner?.consentResetAt ?? null)).toHaveLength(
      2,
    );
    expect(await ctx.privacy.whatsapp.hasConsent(id)).toBe(false);
  });

  it('SPEC-010: linking a CONFIRMED account keeps its consents and its answered prompt', async () => {
    const owner = ctx.users.seed(
      account({ emailVerified: true, whatsappPromptAnsweredAt: CREATED }),
    );
    const id = owner._id as string;
    await ctx.privacy.consents.recordAcceptance(
      id,
      { terms: '0.1', privacy: '0.1' },
      'signup_email',
    );
    await ctx.privacy.whatsapp.record(id, 'granted', 'signup', null);
    const code = await ctx.service.beginGoogleSignIn(identity());

    await ctx.service.exchangeGoogleCode(code);

    expect(ctx.users.accounts.get(id)?.consentResetAt).toBeUndefined();
    expect(ctx.users.accounts.get(id)?.whatsappPromptAnsweredAt).toEqual(CREATED);
    expect(await ctx.privacy.consents.pendingFor(id, null)).toEqual([]);
    expect(await ctx.privacy.whatsapp.hasConsent(id)).toBe(true);
  });

  it('race: an account that appeared since the redirect keeps its own acceptance; none is recorded for it', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());
    ctx.users.seed(account({ _id: '64b000000000000000000009' }));

    await ctx.service.completeGoogleSignup(code);

    expect(ctx.privacy.consentsRepo.rows).toEqual([]);
    expect(ctx.privacy.whatsappRepo.rows).toEqual([]);
  });

  it('spends the code: a second completion is INVALID_GOOGLE_CODE and creates nothing more', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());
    await ctx.service.completeGoogleSignup(code);

    await expect(ctx.service.completeGoogleSignup(code)).rejects.toEqual(
      new DomainError('INVALID_GOOGLE_CODE'),
    );
    expect(ctx.users.accounts.size).toBe(1);
  });

  it('refuses an expired code (15 minutes) and creates nothing', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());
    ctx.clock.advance(16 * MINUTE);

    await expect(ctx.service.completeGoogleSignup(code)).rejects.toEqual(
      new DomainError('INVALID_GOOGLE_CODE'),
    );
    expect(ctx.users.accounts.size).toBe(0);
  });

  it('refuses a code of the exchange kind', async () => {
    ctx.users.seed(account());
    const code = await ctx.service.beginGoogleSignIn(identity());

    await expect(ctx.service.completeGoogleSignup(code)).rejects.toEqual(
      new DomainError('INVALID_GOOGLE_CODE'),
    );
  });

  it('race: an account registered with that email since the redirect is signed in with the same rules (confirmed: linked, password stays)', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());
    const racer = ctx.users.seed(account());

    const result = await ctx.service.completeGoogleSignup(code);

    expect(ctx.users.accounts.size).toBe(1);
    expect(racer).toMatchObject({
      googleId: 'g-1',
      password: 'the-password',
      providers: ['local', 'google'],
    });
    expect(result.user._id).toBe('64b000000000000000000001');
  });

  it('race: an unconfirmed pre-registration is taken over, exactly like a sign-in', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());
    const racer = ctx.users.seed(account({ emailVerified: false }));

    await ctx.service.completeGoogleSignup(code);

    expect(racer.password).toBeUndefined();
    expect(racer.providers).toEqual(['google']);
    expect(racer.emailVerified).toBe(true);
  });

  it('race: the account appearing between the lookup and the insert is linked, not duplicated', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());
    const racer = account();
    const lookup = vi.spyOn(ctx.users, 'findByEmail');
    lookup.mockResolvedValueOnce(null).mockImplementation(async () => racer);
    vi.spyOn(ctx.users, 'createGoogleAccount').mockRejectedValue(
      new DomainError('EMAIL_ALREADY_REGISTERED'),
    );
    ctx.users.seed(racer);

    const result = await ctx.service.completeGoogleSignup(code);

    expect(result.user._id).toBe('64b000000000000000000001');
    expect(racer.googleId).toBe('g-1');
  });

  it('race: a registered email that cannot be found afterwards still fails as EMAIL_ALREADY_REGISTERED', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());
    vi.spyOn(ctx.users, 'createGoogleAccount').mockRejectedValue(
      new DomainError('EMAIL_ALREADY_REGISTERED'),
    );

    await expect(ctx.service.completeGoogleSignup(code)).rejects.toEqual(
      new DomainError('EMAIL_ALREADY_REGISTERED'),
    );
  });

  it('does not swallow other failures of the account creation', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());
    vi.spyOn(ctx.users, 'createGoogleAccount').mockRejectedValue(new Error('network'));

    await expect(ctx.service.completeGoogleSignup(code)).rejects.toThrow('network');
  });

  it('a Google identity linked to an inactive account cannot sign up again', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());
    ctx.users.seed(
      account({
        email: 'other@example.test',
        googleId: 'g-1',
        providers: ['google'],
        status: 'closed',
      }),
    );

    await expect(ctx.service.completeGoogleSignup(code)).rejects.toEqual(
      new DomainError('GOOGLE_SIGN_IN_FAILED'),
    );
  });
});

describe('AuthService.cancelGoogleSignup (SPEC-010 BR-010-01)', () => {
  it('deletes the unused code and the profile, so a later completion fails', async () => {
    const code = await ctx.service.beginGoogleSignIn(identity());

    await ctx.service.cancelGoogleSignup(code);

    expect(ctx.tokenRepo.stored).toEqual([]);
    expect(ctx.users.accounts.size).toBe(0);
    // BR-010-01: declining stores nothing at all: no account, no acceptance, no WhatsApp answer.
    expect(ctx.privacy.consentsRepo.rows).toEqual([]);
    expect(ctx.privacy.whatsappRepo.rows).toEqual([]);
    await expect(ctx.service.completeGoogleSignup(code)).rejects.toEqual(
      new DomainError('INVALID_GOOGLE_CODE'),
    );
  });

  it('answers alike for an unknown code', async () => {
    await expect(ctx.service.cancelGoogleSignup('unknown-code')).resolves.toBeUndefined();
  });
});
