// SPEC-010 BR-010-27: the WhatsApp consent is a log of answers; the current state is the latest
// one. Pure (AR-05).

export const WHATSAPP_ACTIONS = ['granted', 'withdrawn', 'declined'] as const;
export type WhatsappAction = (typeof WHATSAPP_ACTIONS)[number];

/** `signup` is recorded by the sign-up itself; the other two are the account's own answers. */
export const WHATSAPP_METHODS = ['signup', 'existing_account_prompt', 'privacy_page'] as const;
export type WhatsappMethod = (typeof WHATSAPP_METHODS)[number];

/** The methods an authenticated answer may carry (POST /privacy/whatsapp-consent). */
export const WHATSAPP_ANSWER_METHODS = ['existing_account_prompt', 'privacy_page'] as const;

/**
 * Version of the consent text the person saw (BR-010-27: the choice and the text version it refers
 * to are recorded). The text itself lives in the sign-up and privacy screens; changing it means
 * changing this version in the same change. Placeholder until the lawyer's review (Q-21).
 */
export const WHATSAPP_CONSENT_TEXT_VERSION = '0.1';

export type WhatsappConsentState = 'none' | WhatsappAction;

/** The state after the latest answer; `none` when the account never answered. */
export function consentState(latest: WhatsappAction | null): WhatsappConsentState {
  return latest ?? 'none';
}

/** Only a latest answer of `granted` is a consent: a withdrawal or a refusal is not (BR-010-27). */
export function hasConsent(latest: WhatsappAction | null): boolean {
  return latest === 'granted';
}

/** The sign-up checkbox is unticked by default; leaving it so is a recorded refusal (SC-29). */
export function signupAction(ticked: boolean): WhatsappAction {
  return ticked ? 'granted' : 'declined';
}
