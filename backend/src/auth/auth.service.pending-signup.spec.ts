// SPEC-010 BR-010-01: a sign-up creates the account `pending`, writes the consent records, then
// activates it with one conditional update. Until then every authentication path refuses it, so a
// concurrent sign-in can never obtain a session for an account the rollback might delete. The
// interleavings are held deterministically: the sign-up is paused INSIDE its consent write (a gate
// in the fake repository) while the other request runs (TS-03, TS-06). The conditional queries
// themselves are held against MongoDB in test/integration/privacy.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service.js';
import { DomainError } from '../common/errors/domain-error.js';
import type { EmailService } from '../email/email.service.js';
import type { UsersService } from '../users/users.service.js';
import { PENDING_SIGNUP_TTL_MS } from '../users/user-account.js';
import type { GoogleIdentity } from './google/google-identity.js';
import { AccountTokenService } from './tokens/account-token.service.js';
import type { AccountTokenRepository } from './tokens/account-token.repository.js';
import { SessionsService } from './sessions/sessions.service.js';
import type { SessionsRepository } from './sessions/sessions.repository.js';
import { LoginAttemptsService } from './login-attempts/login-attempts.service.js';
import type { LoginAttemptsRepository } from './login-attempts/login-attempts.repository.js';
import { FakeClock, MINUTE } from '../../test/fakes/fake-clock.js';
import { FakeEmailSender } from '../../test/fakes/fake-email-sender.js';
import {
  FakeAccountTokenRepository,
  FakeLoginAttemptsRepository,
  FakeSessionsRepository,
} from '../../test/fakes/fake-auth-repositories.js';
import { FakeUsersService } from '../../test/fakes/fake-users-service.js';
import { spyOnLogger } from '../../test/support/logger-spy.js';
import { wirePrivacy } from '../../test/support/privacy-services.js';

function build() {
  const users = new FakeUsersService();
  const clock = new FakeClock();
  const email = new FakeEmailSender();
  const tokenRepo = new FakeAccountTokenRepository();
  const sessionRepo = new FakeSessionsRepository();
  const sign = vi.fn((payload: { sub: string }) => `jwt:${payload.sub}`);
  const privacy = wirePrivacy(clock, users as unknown as UsersService);
  const service = new AuthService(
    users as unknown as UsersService,
    { sign } as unknown as JwtService,
    email as unknown as EmailService,
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
  return { service, users, clock, email, tokenRepo, sessionRepo, privacy };
}

/** Holds the sign-up inside its first consent write until the test lets it go (or fail). */
function pauseConsentWrite(privacy: ReturnType<typeof build>['privacy']) {
  let reachedResolve!: () => void;
  const reached = new Promise<void>((resolve) => (reachedResolve = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  privacy.consentsRepo.beforeInsert = async () => {
    reachedResolve();
    await released;
  };
  return { reached, release };
}

const registration = {
  email: 'new@example.test',
  password: 'a-password',
  name: 'New User',
  acceptTerms: true,
} as const;

const google = (overrides: Partial<GoogleIdentity> = {}): GoogleIdentity => ({
  googleId: 'g-1',
  email: 'ana@example.test',
  emailVerified: true,
  name: 'Ana Teste',
  ...overrides,
});

async function error(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (reason: unknown) => reason,
  );
}

describe('BR-010-01: a Google sign-up in flight is invisible to every other sign-in', () => {
  it('a concurrent Google sign-in and code exchange are refused, no session exists, and the failed consent write leaves nothing', async () => {
    const ctx = build();
    const logged = spyOnLogger();
    const first = await ctx.service.beginGoogleSignIn(google());
    const second = await ctx.service.beginGoogleSignIn(google()); // another tab, same person
    const gate = pauseConsentWrite(ctx.privacy);

    const original = ctx.service.completeGoogleSignup(first);
    const settled = error(original);
    await gate.reached;
    // The account exists, `pending`, while its consent records are being written...
    expect([...ctx.users.accounts.values()].map((a) => a.status)).toEqual(['pending']);

    // ...and a second sign-in finds it by the Google id and by the email, and is refused.
    expect(await error(ctx.service.beginGoogleSignIn(google()))).toEqual(
      new DomainError('GOOGLE_SIGN_IN_FAILED'),
    );
    expect(await error(ctx.service.beginGoogleSignIn(google({ googleId: 'g-other' })))).toEqual(
      new DomainError('GOOGLE_SIGN_IN_FAILED'),
    );
    // The other tab's code, finished now, is refused too (and no session, no favourites).
    expect(await error(ctx.service.completeGoogleSignup(second))).toEqual(
      new DomainError('GOOGLE_SIGN_IN_FAILED'),
    );
    expect(ctx.sessionRepo.stored).toEqual([]);
    expect(ctx.tokenRepo.stored.filter((t) => t.purpose === 'google_exchange')).toEqual([]);

    // The original consent write now fails: the rollback deletes the pending account...
    ctx.privacy.consentsRepo.failInsertsWith = new Error('db down');
    gate.release();
    expect(await settled).toEqual(new Error('db down'));

    // ...and nothing was orphaned: no account, no session, no consent row.
    expect(ctx.users.accounts.size).toBe(0);
    expect(ctx.sessionRepo.stored).toEqual([]);
    expect(ctx.privacy.consentsRepo.rows).toEqual([]);
    expect(logged.loggedText()).toContain('account rolled back');
  });

  it('when the consent write succeeds the account is activated and the original request gets its session', async () => {
    const ctx = build();
    const code = await ctx.service.beginGoogleSignIn(google());
    const gate = pauseConsentWrite(ctx.privacy);

    const original = ctx.service.completeGoogleSignup(code);
    await gate.reached;
    gate.release();

    await expect(original).resolves.toMatchObject({ accessToken: expect.any(String) });
    expect([...ctx.users.accounts.values()].map((a) => a.status)).toEqual(['active']);
    expect(ctx.sessionRepo.stored).toHaveLength(1);
    // Now the account is a normal one: a later Google sign-in gets an exchange code.
    await expect(ctx.service.beginGoogleSignIn(google())).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('BR-010-01: an e-mail sign-up in flight cannot be signed in to, reset or confirmed', () => {
  it('login with the right password, a reset request and a Google sign-in are refused; the failed consent write leaves nothing', async () => {
    const ctx = build();
    const gate = pauseConsentWrite(ctx.privacy);

    const original = ctx.service.register(registration);
    const settled = error(original);
    await gate.reached;
    expect([...ctx.users.accounts.values()].map((a) => a.status)).toEqual(['pending']);

    expect(
      await error(
        ctx.service.login(
          { email: registration.email, password: registration.password },
          '203.0.113.7',
        ),
      ),
    ).toEqual(new DomainError('INVALID_CREDENTIALS'));
    expect(
      await error(
        ctx.service.beginGoogleSignIn(google({ email: registration.email, googleId: 'g-9' })),
      ),
    ).toEqual(new DomainError('GOOGLE_SIGN_IN_FAILED'));
    await ctx.service.requestPasswordReset(registration.email);
    await ctx.service.flushDeliveries();
    expect(ctx.email.passwordResetEmails).toEqual([]);
    expect(ctx.sessionRepo.stored).toEqual([]);

    ctx.privacy.consentsRepo.failInsertsWith = new Error('db down');
    gate.release();
    expect(await settled).toEqual(new Error('db down'));

    expect(ctx.users.accounts.size).toBe(0);
    expect(ctx.sessionRepo.stored).toEqual([]);
    expect(ctx.email.verificationEmails).toEqual([]);
    expect(
      await error(
        ctx.service.login(
          { email: registration.email, password: registration.password },
          '203.0.113.7',
        ),
      ),
    ).toEqual(new DomainError('INVALID_CREDENTIALS'));
  });

  it('after a successful sign-up the same login works', async () => {
    const ctx = build();
    await ctx.service.register(registration);

    await expect(
      ctx.service.login(
        { email: registration.email, password: registration.password },
        '203.0.113.7',
      ),
    ).resolves.toMatchObject({ user: { email: registration.email } });
  });
});

describe('BR-010-01: an abandoned pending account does not hold the address', () => {
  /** A sign-up that crashed after creating the account: pending, with no consent rows. */
  async function abandoned(ctx: ReturnType<typeof build>, email: string, googleId?: string) {
    const created = googleId
      ? await ctx.users.createGoogleAccount({ googleId, email, name: 'Crashed' }, ctx.clock.now())
      : await ctx.users.createLocalAccount(
          { email, name: 'Crashed', password: 'old-password' },
          ctx.clock.now(),
        );
    return typeof created._id === 'string' ? created._id : created._id.toHexString();
  }

  it('a sign-up that collides with a pending account older than 15 minutes replaces it', async () => {
    const ctx = build();
    const oldId = await abandoned(ctx, registration.email);
    ctx.clock.advance(PENDING_SIGNUP_TTL_MS + MINUTE);

    await ctx.service.register(registration);

    expect(ctx.users.accounts.has(oldId)).toBe(false);
    const accounts = [...ctx.users.accounts.values()];
    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.status).toBe('active');
  });

  it('a pending account younger than that answers as a taken e-mail and is left alone', async () => {
    const ctx = build();
    const youngId = await abandoned(ctx, registration.email);
    ctx.clock.advance(PENDING_SIGNUP_TTL_MS - MINUTE);

    expect(await error(ctx.service.register(registration))).toEqual(
      new DomainError('EMAIL_ALREADY_REGISTERED'),
    );

    expect(ctx.users.accounts.get(youngId)?.status).toBe('pending');
    expect(ctx.privacy.consentsRepo.rows).toEqual([]);
  });

  it('an ACTIVE account is never replaced, however old', async () => {
    const ctx = build();
    const id = await abandoned(ctx, registration.email);
    await ctx.users.activateAccount(id);
    ctx.clock.advance(PENDING_SIGNUP_TTL_MS * 10);

    expect(await error(ctx.service.register(registration))).toEqual(
      new DomainError('EMAIL_ALREADY_REGISTERED'),
    );

    expect(ctx.users.accounts.get(id)?.status).toBe('active');
  });

  it('a Google sign-in and completion replace a stale pending account of the same identity', async () => {
    const ctx = build();
    const oldId = await abandoned(ctx, 'ana@example.test', 'g-1');
    ctx.clock.advance(PENDING_SIGNUP_TTL_MS + MINUTE);

    const code = await ctx.service.beginGoogleSignIn(google());
    expect(ctx.users.accounts.has(oldId)).toBe(false);
    await ctx.service.completeGoogleSignup(code);

    const accounts = [...ctx.users.accounts.values()];
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({ googleId: 'g-1', status: 'active' });
  });

  it('a fresh pending account of the same Google identity refuses the sign-in and survives', async () => {
    const ctx = build();
    const youngId = await abandoned(ctx, 'ana@example.test', 'g-1');
    ctx.clock.advance(PENDING_SIGNUP_TTL_MS - MINUTE);

    expect(await error(ctx.service.beginGoogleSignIn(google()))).toEqual(
      new DomainError('GOOGLE_SIGN_IN_FAILED'),
    );

    expect(ctx.users.accounts.get(youngId)?.status).toBe('pending');
    expect(ctx.sessionRepo.stored).toEqual([]);
  });
});

describe('BR-010-01: when the activation itself fails', () => {
  it('and the rollback also fails, the account stays pending and cannot sign in', async () => {
    const ctx = build();
    const logged = spyOnLogger();
    ctx.users.activateAccount = async () => {
      throw new Error('activation failed');
    };
    ctx.users.discardUnfinishedSignup = async () => {
      throw new Error('delete failed');
    };

    await expect(ctx.service.register(registration)).rejects.toThrow('activation failed');

    const [stuck] = [...ctx.users.accounts.values()];
    expect(stuck?.status).toBe('pending');
    // The consent rows exist but the account is unusable: no session, no login, no reset.
    expect(ctx.sessionRepo.stored).toEqual([]);
    expect(ctx.email.verificationEmails).toEqual([]);
    expect(
      await error(
        ctx.service.login(
          { email: registration.email, password: registration.password },
          '203.0.113.7',
        ),
      ),
    ).toEqual(new DomainError('INVALID_CREDENTIALS'));
    expect(logged.loggedText()).toContain(
      'Sign-up activation could not be completed (Error); account NOT rolled back',
    );
  });

  it('with the rollback working, the account is deleted and the address is free', async () => {
    const ctx = build();
    ctx.users.activateAccount = async () => false; // the update matched nothing

    await expect(ctx.service.register(registration)).rejects.toThrow();

    expect(ctx.users.accounts.size).toBe(0);
    expect(ctx.sessionRepo.stored).toEqual([]);
  });
});
