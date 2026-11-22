// SPEC-010 BR-010-27 (TS-08): the WhatsApp consent is its latest answer; an unticked checkbox is a
// recorded refusal; a withdrawal is not a consent.
import { describe, expect, it } from 'vitest';
import {
  consentState,
  hasConsent,
  signupAction,
  WHATSAPP_ACTIONS,
  WHATSAPP_ANSWER_METHODS,
  WHATSAPP_CONSENT_TEXT_VERSION,
  WHATSAPP_METHODS,
} from './whatsapp-consent.js';

describe('BR-010-27: WhatsApp consent state', () => {
  it('BR-010-27: only a latest answer of granted is a consent', () => {
    expect(hasConsent('granted')).toBe(true);
    expect(hasConsent('withdrawn')).toBe(false);
    expect(hasConsent('declined')).toBe(false);
    expect(hasConsent(null)).toBe(false);
  });

  it('is `none` before any answer, otherwise the latest action', () => {
    expect(consentState(null)).toBe('none');
    expect(consentState('granted')).toBe('granted');
    expect(consentState('withdrawn')).toBe('withdrawn');
    expect(consentState('declined')).toBe('declined');
  });

  it('SC-29: the sign-up checkbox is a recorded choice either way; unticked is declined', () => {
    expect(signupAction(true)).toBe('granted');
    expect(signupAction(false)).toBe('declined');
  });

  it('names the actions, the methods and a text version', () => {
    expect(WHATSAPP_ACTIONS).toEqual(['granted', 'withdrawn', 'declined']);
    expect(WHATSAPP_METHODS).toEqual(['signup', 'existing_account_prompt', 'privacy_page']);
    // The sign-up method is recorded by the sign-up itself, never accepted from an authenticated call.
    expect(WHATSAPP_ANSWER_METHODS).toEqual(['existing_account_prompt', 'privacy_page']);
    expect(WHATSAPP_CONSENT_TEXT_VERSION).toMatch(/^\d+(\.\d+)*$/);
  });
});
