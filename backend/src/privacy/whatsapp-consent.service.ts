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
   * on the account, whichever the answer (BR-010-27). The row comes first: if marking the account
   * fails, the account is simply asked again, and nothing it said is lost.
   */
  async record(
    userId: string,
    action: WhatsappAction,
    method: WhatsappMethod,
  ): Promise<WhatsappConsentView> {
    const at = this.clock.now();
    await this.answers.insert({
      userId,
      action,
      method,
      textVersion: WHATSAPP_CONSENT_TEXT_VERSION,
      at,
    });
    await this.users.markWhatsappPromptAnswered(userId, at);
    return { state: consentState(action), at, textVersion: WHATSAPP_CONSENT_TEXT_VERSION };
  }

  /** At sign-up: the checkbox, unticked by default; leaving it unticked is recorded (BR-010-27). */
  recordAtSignup(userId: string, ticked: boolean): Promise<WhatsappConsentView> {
    return this.record(userId, signupAction(ticked), 'signup');
  }

  /** The account's current state and when it last changed. */
  async current(userId: string): Promise<WhatsappConsentView> {
    const latest = await this.answers.latest(userId);
    return {
      state: consentState(latest?.action ?? null),
      at: latest?.at ?? null,
      textVersion: latest?.textVersion ?? null,
    };
  }

  /** True only when the account's latest answer is `granted`. Exported for SPEC-008 and SPEC-025. */
  async hasConsent(userId: string): Promise<boolean> {
    return hasConsent((await this.answers.latest(userId))?.action ?? null);
  }
}
