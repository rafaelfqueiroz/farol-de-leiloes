// SPEC-010 BR-010-27 (TS-08, TS-06): the WhatsApp consent as a log of answers, the one-time request
// marked as answered on the account, and the question SPEC-008 / SPEC-025 will ask.
import { describe, expect, it } from 'vitest';
import { FakeClock, MINUTE } from '../../test/fakes/fake-clock.js';
import { FakeWhatsappConsentRepository } from '../../test/fakes/fake-privacy-repositories.js';
import { FakeUsersService } from '../../test/fakes/fake-users-service.js';
import type { UsersService } from '../users/users.service.js';
import { WHATSAPP_CONSENT_TEXT_VERSION } from './domain/whatsapp-consent.js';
import { WhatsappConsentService } from './whatsapp-consent.service.js';

const T0 = new Date('2026-06-01T12:00:00.000Z');
const USER = '64b000000000000000000001';
const OTHER = '64b000000000000000000002';

function build() {
  const clock = new FakeClock(T0);
  const users = new FakeUsersService();
  users.seed({
    _id: USER,
    email: 'ana@example.test',
    name: 'Ana',
    providers: ['local'],
    createdAt: T0,
    updatedAt: T0,
  });
  const repo = new FakeWhatsappConsentRepository();
  const service = new WhatsappConsentService(
    repo as never,
    users as unknown as UsersService,
    clock,
  );
  return { clock, users, repo, service };
}

describe('BR-010-27: recording the answers', () => {
  it('records a grant with the text version, the method and the time, and marks the account', async () => {
    const { users, repo, service } = build();

    const view = await service.record(USER, 'granted', 'privacy_page', null);

    expect(repo.rows).toEqual([
      {
        userId: USER,
        action: 'granted',
        method: 'privacy_page',
        textVersion: WHATSAPP_CONSENT_TEXT_VERSION,
        at: T0,
        consentResetAt: null,
      },
    ]);
    expect(view).toEqual({ state: 'granted', at: T0, textVersion: WHATSAPP_CONSENT_TEXT_VERSION });
    expect(users.accounts.get(USER)?.whatsappPromptAnsweredAt).toEqual(T0);
  });

  it.each(['granted', 'declined', 'withdrawn'] as const)(
    'BR-010-27: the one-time request counts as answered whichever the answer (%s)',
    async (action) => {
      const { users, service } = build();
      await service.record(USER, action, 'existing_account_prompt', null);
      expect(users.accounts.get(USER)?.whatsappPromptAnsweredAt).toEqual(T0);
    },
  );

  it("keeps the first answer's instant on the account when it answers again", async () => {
    const { clock, users, service } = build();
    await service.record(USER, 'declined', 'existing_account_prompt', null);
    clock.advance(10 * MINUTE);

    await service.record(USER, 'granted', 'privacy_page', null);

    expect(users.accounts.get(USER)?.whatsappPromptAnsweredAt).toEqual(T0);
  });

  it('records the sign-up checkbox either way: unticked is declined, ticked is granted', async () => {
    const { repo, service } = build();
    await service.recordAtSignup(USER, false);
    await service.recordAtSignup(OTHER, true);

    expect(repo.rows.map((r) => [r.userId, r.action, r.method])).toEqual([
      [USER, 'declined', 'signup'],
      [OTHER, 'granted', 'signup'],
    ]);
  });

  it('does not stop the answer being recorded when the account is gone: the row comes first', async () => {
    const { repo, service } = build();
    // OTHER is unknown to the users fake, so marking it is a no-op; the answer is kept.
    await service.record(OTHER, 'granted', 'privacy_page', null);
    expect(repo.rows).toHaveLength(1);
  });
});

describe('BR-010-27: the current state and hasConsent', () => {
  it('is `none` and no consent before any answer', async () => {
    const { service } = build();
    expect(await service.current(USER, null)).toEqual({
      state: 'none',
      at: null,
      textVersion: null,
    });
    expect(await service.hasConsent(USER)).toBe(false);
  });

  it('is the latest answer: granted, then withdrawn, then granted again', async () => {
    const { clock, service } = build();

    await service.record(USER, 'granted', 'privacy_page', null);
    expect(await service.hasConsent(USER)).toBe(true);

    clock.advance(MINUTE);
    await service.record(USER, 'withdrawn', 'privacy_page', null);
    expect(await service.hasConsent(USER)).toBe(false);
    expect(await service.current(USER, null)).toEqual({
      state: 'withdrawn',
      at: new Date(T0.getTime() + MINUTE),
      textVersion: WHATSAPP_CONSENT_TEXT_VERSION,
    });

    clock.advance(MINUTE);
    await service.record(USER, 'granted', 'privacy_page', null);
    expect(await service.hasConsent(USER)).toBe(true);
  });

  it('a refusal at sign-up is not a consent', async () => {
    const { service } = build();
    await service.recordAtSignup(USER, false);
    expect(await service.hasConsent(USER)).toBe(false);
    expect((await service.current(USER, null)).state).toBe('declined');
  });

  it("BR-002-11: one account's answer is nobody else's", async () => {
    const { service } = build();
    await service.record(USER, 'granted', 'privacy_page', null);
    expect(await service.hasConsent(OTHER)).toBe(false);
    expect((await service.current(OTHER, null)).state).toBe('none');
  });
});

describe('BR-010-27: answering what the latest answer already says', () => {
  it('records nothing new, still marks the prompt as answered and answers the current state', async () => {
    const { clock, users, repo, service } = build();
    await service.record(USER, 'granted', 'privacy_page', null);
    delete users.accounts.get(USER)?.whatsappPromptAnsweredAt; // as if the flag were missing
    clock.advance(10 * MINUTE);

    const view = await service.record(USER, 'granted', 'privacy_page', null);

    expect(repo.rows).toHaveLength(1);
    // The state reported is the recorded one: its own instant, not the repeat's.
    expect(view).toEqual({ state: 'granted', at: T0, textVersion: WHATSAPP_CONSENT_TEXT_VERSION });
    expect(users.accounts.get(USER)?.whatsappPromptAnsweredAt).toEqual(
      new Date(T0.getTime() + 10 * MINUTE),
    );
  });

  it('a different answer is recorded, and so is the first one, even when it equals nothing', async () => {
    const { repo, service } = build();
    await service.record(USER, 'declined', 'existing_account_prompt', null);
    await service.record(USER, 'granted', 'privacy_page', null);
    await service.record(USER, 'withdrawn', 'privacy_page', null);
    await service.record(USER, 'granted', 'privacy_page', null); // differs from the latest (withdrawn)

    expect(repo.rows.map((r) => r.action)).toEqual(['declined', 'granted', 'withdrawn', 'granted']);
  });
});

describe('DL-001-02: consent generations (a Google takeover of an unconfirmed account)', () => {
  const RESET = new Date('2026-06-02T09:00:00.000Z');

  it("an answer given before the takeover is not the owner's: no consent, state none", async () => {
    const { users, service } = build();
    await service.recordAtSignup(USER, true); // the registrant ticked the box
    expect(await service.hasConsent(USER)).toBe(true);

    const account = users.accounts.get(USER);
    if (account) account.consentResetAt = RESET; // the owner's takeover

    expect(await service.hasConsent(USER)).toBe(false);
    expect(await service.current(USER, RESET)).toEqual({
      state: 'none',
      at: null,
      textVersion: null,
    });
  });

  it("the owner's own answer, under the new generation, counts; the registrant's rows stay as history", async () => {
    const { users, repo, service } = build();
    await service.recordAtSignup(USER, true);
    const account = users.accounts.get(USER);
    if (account) {
      account.consentResetAt = RESET;
      delete account.whatsappPromptAnsweredAt; // the takeover clears it
    }

    await service.record(USER, 'granted', 'existing_account_prompt', RESET);

    expect(await service.hasConsent(USER)).toBe(true);
    expect(repo.rows.map((r) => [r.action, r.consentResetAt])).toEqual([
      ['granted', null],
      ['granted', RESET],
    ]); // identical answer, but under another generation: recorded
    expect(users.accounts.get(USER)?.whatsappPromptAnsweredAt).toBeDefined();
  });

  it("a registrant's write that lands after the takeover marks nothing and counts for nobody", async () => {
    const { users, service } = build();
    const account = users.accounts.get(USER);
    if (account) account.consentResetAt = RESET;

    await service.recordAtSignup(USER, true); // generation null: the registrant's request, late

    expect(users.accounts.get(USER)?.whatsappPromptAnsweredAt).toBeUndefined();
    expect(await service.hasConsent(USER)).toBe(false);
  });

  it('an account that does not exist has no consent', async () => {
    expect(await build().service.hasConsent('64b0000000000000000000ff')).toBe(false);
  });
});
