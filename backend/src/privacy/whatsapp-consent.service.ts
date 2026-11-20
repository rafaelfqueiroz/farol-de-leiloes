// SPEC-010 BR-010-27, BR-010-03: the WhatsApp consent, separate from the terms (D-55). Every answer
// is a new row; the state is the latest row. `hasConsent` is the question SPEC-008 and SPEC-025 ask
// before sending a WhatsApp message (necessary, never sufficient: the per-event channel choice and
// a verified phone number are still required).
import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock/clock.js';
import { UsersService } from '../users/users.service.js';
import {
  consentState,
  hasConsent,
  repeatsLatest,
  signupAction,
  WHATSAPP_CONSENT_TEXT_VERSION,
  type WhatsappAction,
  type WhatsappConsentState,
  type WhatsappMethod,
} from './domain/whatsapp-consent.js';
import { WhatsappConsentRepository } from './whatsapp-consent.repository.js';

export interface WhatsappConsentView {
  readonly state: WhatsappConsentState;
  readonly at: Date | null;
  readonly textVersion: string | null;
}

@Injectable()
export class WhatsappConsentService {
  constructor(
    private readonly answers: WhatsappConsentRepository,
    private readonly users: UsersService,
    private readonly clock: Clock,
  ) {}

  /**
   * Records an answer (granted, withdrawn or declined) and marks the one-time request as answered
   * on the account, whichever the answer (BR-010-27). Answering what the account's latest answer
   * already says is not recorded again, but still marks the request and answers the state.
   *
   * `consentResetAt` is the account's consent generation (DL-001-02): null for an account created
   * by this request, the account's own value otherwise. Only answers of that generation exist for
   * the account, and the new row is written under it.
   *
   * The row comes first: if marking the account fails, the account is simply asked again, and
   * nothing it said is lost.
   */
  async record(
    userId: string,
    action: WhatsappAction,
    method: WhatsappMethod,
    consentResetAt: Date | null,
  ): Promise<WhatsappConsentView> {
    const at = this.clock.now();
    const latest = await this.answers.latest(userId, consentResetAt);
    let view: WhatsappConsentView;
    if (latest !== null && repeatsLatest(latest.action, action)) {
      view = { state: consentState(latest.action), at: latest.at, textVersion: latest.textVersion };
    } else {
      await this.answers.insert({
        userId,
        action,
        method,
        textVersion: WHATSAPP_CONSENT_TEXT_VERSION,
        at,
        consentResetAt,
      });
      view = { state: consentState(action), at, textVersion: WHATSAPP_CONSENT_TEXT_VERSION };
    }
    await this.users.markWhatsappPromptAnswered(userId, at, consentResetAt);
    return view;
  }

  /** At sign-up: the checkbox, unticked by default; leaving it unticked is recorded (BR-010-27). */
  recordAtSignup(userId: string, ticked: boolean): Promise<WhatsappConsentView> {
    // A new account has never been reset: generation null (the account was just created here).
    return this.record(userId, signupAction(ticked), 'signup', null);
  }

  /** The account's current state and when it last changed, under its consent generation. */
  async current(userId: string, consentResetAt: Date | null): Promise<WhatsappConsentView> {
    const latest = await this.answers.latest(userId, consentResetAt);
    return {
      state: consentState(latest?.action ?? null),
      at: latest?.at ?? null,
      textVersion: latest?.textVersion ?? null,
    };
  }

  /**
   * True only when the account's latest answer, under its current consent generation, is
   * `granted`. An answer written before a Google takeover of the account (by whoever registered
   * the address, DL-001-02) is not the owner's and never counts. Exported for SPEC-008 and
   * SPEC-025, which know only the account: the generation is read from the account here.
   */
  async hasConsent(userId: string): Promise<boolean> {
    const account = await this.users.findById(userId);
    if (account === null) return false;
    const latest = await this.answers.latest(userId, account.consentResetAt ?? null);
    return hasConsent(latest?.action ?? null);
  }
}
