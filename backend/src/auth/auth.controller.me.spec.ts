// SPEC-010 BR-010-05: GET /auth/me reports the documents still to accept only while the server
// enforces the acceptance (TERMS_ENFORCEMENT_ENABLED), read once from the typed config (AR-42).
// The whatsappPromptPending question does not depend on it (BR-010-27).
import { describe, expect, it, vi } from 'vitest';
import type { AccessContext } from '../access/access-context.js';
import { testConfigService } from '../../test/support/test-env.js';
import { AuthController } from './auth.controller.js';
import type { AuthService } from './auth.service.js';
import type { AuthenticatedUser } from './interfaces/auth.interface.js';
import type { ConsentsService } from '../privacy/consents.service.js';

const PENDING = [{ type: 'terms', version: '0.2' }] as const;
const user = {
  userId: 'u1',
  email: 'ana@example.test',
  name: 'Ana',
  emailVerified: true,
  providers: ['local'],
  role: 'free',
  subscriptionStatus: null,
  whatsappPromptPending: true,
} as unknown as AuthenticatedUser;
const access = { isAdmin: false, personas: ['searcher'] } as unknown as AccessContext;

function controller(enforced: boolean) {
  const pendingFor = vi.fn().mockResolvedValue(PENDING);
  const consents = { pendingFor } as unknown as ConsentsService;
  const config = testConfigService({ TERMS_ENFORCEMENT_ENABLED: String(enforced) });
  return { pendingFor, controller: new AuthController({} as AuthService, config, consents) };
}

describe('GET /auth/me and TERMS_ENFORCEMENT_ENABLED', () => {
  it('on: reports the documents still to accept', async () => {
    const { controller: me, pendingFor } = controller(true);

    const body = await me.getProfile(user, access);

    expect(body.termsAcceptanceRequired).toBe(true);
    expect(body.documents).toEqual([{ type: 'terms', version: '0.2' }]);
    expect(pendingFor).toHaveBeenCalledTimes(1);
  });

  it('off: asks for nothing and reads nothing, but still reports the WhatsApp question', async () => {
    const { controller: me, pendingFor } = controller(false);

    const body = await me.getProfile(user, access);

    expect(body.termsAcceptanceRequired).toBe(false);
    expect(body.documents).toEqual([]);
    expect(body.whatsappPromptPending).toBe(true);
    expect(pendingFor).not.toHaveBeenCalled();
  });
});
