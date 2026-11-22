// SPEC-010 BR-010-05, DL-010-03 (TS-08): the current-terms guard, with the flag, the exemptions and
// the refusal context. The guard over HTTP, with the real registry order, is
// test/integration/privacy.spec.ts; the registration order is jwt-auth.guard.spec.ts; the exact set
// of exempt routes is test/structural/allow-without-terms-routes.spec.ts.
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { IS_PUBLIC, REQUIRES_ACCESS } from '../../auth/decorators/public.decorator.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { testConfigService } from '../../../test/support/test-env.js';
import { ALLOW_WITHOUT_TERMS } from '../decorators/allow-without-terms.decorator.js';
import type { ConsentsService } from '../consents.service.js';
import { CurrentTermsGuard } from './current-terms.guard.js';

const PENDING = [
  { type: 'terms', version: '0.2' },
  { type: 'privacy', version: '0.2' },
] as const;

function contextFor(
  request: object,
  handler: () => void = () => undefined,
  controller: object = class Probe {},
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function build(enabled: boolean, pending: readonly { type: string; version: string }[] = PENDING) {
  const pendingFor = vi.fn().mockResolvedValue(pending);
  const guard = new CurrentTermsGuard(
    new Reflector(),
    { pendingFor } as unknown as ConsentsService,
    testConfigService({ TERMS_ENFORCEMENT_ENABLED: String(enabled) }),
  );
  return { guard, pendingFor };
}

const SIGNED_IN = { user: { userId: 'account-1', consentResetAt: null } };

describe('BR-010-05: refusing the account features until the current terms are accepted', () => {
  it('refuses with TERMS_ACCEPTANCE_REQUIRED listing the documents, ids and versions only', async () => {
    const { guard, pendingFor } = build(true);

    await expect(guard.canActivate(contextFor(SIGNED_IN))).rejects.toEqual(
      new DomainError('TERMS_ACCEPTANCE_REQUIRED', {
        documents: [
          { type: 'terms', version: '0.2' },
          { type: 'privacy', version: '0.2' },
        ],
      }),
    );
    expect(pendingFor).toHaveBeenCalledWith('account-1', null);
  });

  it('lists only what is pending', async () => {
    const { guard } = build(true, [PENDING[1]]);
    await expect(guard.canActivate(contextFor(SIGNED_IN))).rejects.toMatchObject({
      context: { documents: [{ type: 'privacy', version: '0.2' }] },
    });
  });

  it("DL-001-02: asks for the account's own consent generation, read with the account on this request", async () => {
    const { guard, pendingFor } = build(true, []);
    const reset = new Date('2026-06-02T09:00:00.000Z');

    await guard.canActivate(contextFor({ user: { userId: 'account-1', consentResetAt: reset } }));

    expect(pendingFor).toHaveBeenCalledWith('account-1', reset);
  });

  it('lets an up-to-date account through', async () => {
    const { guard } = build(true, []);
    await expect(guard.canActivate(contextFor(SIGNED_IN))).resolves.toBe(true);
  });

  it('SC-07: refuses a protected route that reached it with no authenticated user', async () => {
    const { guard, pendingFor } = build(true);
    await expect(guard.canActivate(contextFor({}))).rejects.toEqual(
      new DomainError('UNAUTHENTICATED'),
    );
    expect(pendingFor).not.toHaveBeenCalled();
  });
});

describe('BR-010-05, DL-010-03: what is never behind the guard', () => {
  it('skips a public route: nobody is signed in, so no acceptance is read', async () => {
    const { guard, pendingFor } = build(true);
    const handler = () => undefined;
    Reflect.defineMetadata(IS_PUBLIC, true, handler);

    await expect(guard.canActivate(contextFor({}, handler))).resolves.toBe(true);
    expect(pendingFor).not.toHaveBeenCalled();
  });

  it('SC-07: does not skip a @Public() route that also carries an access requirement', async () => {
    const { guard } = build(true);
    const handler = () => undefined;
    Reflect.defineMetadata(IS_PUBLIC, true, handler);
    Reflect.defineMetadata(REQUIRES_ACCESS, true, handler);

    await expect(guard.canActivate(contextFor(SIGNED_IN, handler))).rejects.toMatchObject({
      code: 'TERMS_ACCEPTANCE_REQUIRED',
    });
  });

  it.each([
    ['a handler', 'handler'],
    ['a whole controller', 'class'],
  ] as const)(
    'lets %s marked @AllowWithoutTerms() through, reading nothing',
    async (_what, where) => {
      const { guard, pendingFor } = build(true);
      const handler = () => undefined;
      class Probe {}
      Reflect.defineMetadata(ALLOW_WITHOUT_TERMS, true, where === 'handler' ? handler : Probe);

      await expect(guard.canActivate(contextFor(SIGNED_IN, handler, Probe))).resolves.toBe(true);
      expect(pendingFor).not.toHaveBeenCalled();
    },
  );

  it('an exemption on one handler does not spread to another route', async () => {
    const { guard } = build(true);
    const exempt = () => undefined;
    Reflect.defineMetadata(ALLOW_WITHOUT_TERMS, true, exempt);

    await expect(guard.canActivate(contextFor(SIGNED_IN, () => undefined))).rejects.toMatchObject({
      code: 'TERMS_ACCEPTANCE_REQUIRED',
    });
  });
});

describe('TERMS_ENFORCEMENT_ENABLED', () => {
  it('off: lets everything through and reads no acceptance (the default)', async () => {
    const { guard, pendingFor } = build(false);

    await expect(guard.canActivate(contextFor(SIGNED_IN))).resolves.toBe(true);
    await expect(guard.canActivate(contextFor({}))).resolves.toBe(true);
    expect(pendingFor).not.toHaveBeenCalled();
  });

  it('is off unless the environment turns it on', () => {
    const guard = new CurrentTermsGuard(
      new Reflector(),
      { pendingFor: vi.fn().mockResolvedValue(PENDING) } as unknown as ConsentsService,
      testConfigService(),
    );
    return expect(guard.canActivate(contextFor(SIGNED_IN))).resolves.toBe(true);
  });
});
