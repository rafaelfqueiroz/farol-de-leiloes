// SPEC-010 BR-010-25 (DL-010-07): the legal-validation gate, with the flag, the fail-closed read and
// the refusal context. Over HTTP with real records, the new-version reopening and the checklist it is
// test/integration/legal-validation.spec.ts.
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { DomainError } from '../../common/errors/domain-error.js';
import { spyOnLogger } from '../../../test/support/logger-spy.js';
import { testConfigService } from '../../../test/support/test-env.js';
import { LegalValidationGuard, REQUIRED_LEGAL_VALIDATION } from './legal-validation.guard.js';
import type { LegalValidationService } from './legal-validation.service.js';
import { RequiresLegalValidation } from './requires-legal-validation.decorator.js';

class Probe {
  @RequiresLegalValidation('third-party-processing')
  gated() {
    return 'ok';
  }

  plain() {
    return 'ok';
  }
}

const contextFor = (handler: () => unknown): ExecutionContext =>
  ({ getHandler: () => handler, getClass: () => Probe }) as unknown as ExecutionContext;

function build(env: Record<string, string>, isValidated: () => Promise<boolean>) {
  const service = { isValidated: vi.fn(isValidated) };
  const guard = new LegalValidationGuard(
    new Reflector(),
    service as unknown as LegalValidationService,
    testConfigService(env),
  );
  return { guard, service };
}

const GATED = Probe.prototype.gated;

describe('enforcement follows LEGAL_GATE_ENFORCED, and NODE_ENV when it is unset', () => {
  it('refuses with LEGAL_VALIDATION_REQUIRED and the scope only, when enforced and not validated', async () => {
    const { guard } = build({ LEGAL_GATE_ENFORCED: 'true' }, () => Promise.resolve(false));

    await expect(guard.canActivate(contextFor(GATED))).rejects.toEqual(
      new DomainError('LEGAL_VALIDATION_REQUIRED', { scope: 'third-party-processing' }),
    );
  });

  it('passes when enforced and validated', async () => {
    const { guard, service } = build({ LEGAL_GATE_ENFORCED: 'true' }, () => Promise.resolve(true));

    expect(await guard.canActivate(contextFor(GATED))).toBe(true);
    expect(service.isValidated).toHaveBeenCalledWith('third-party-processing');
  });

  it('passes at once, reading nothing, when not enforced', async () => {
    const { guard, service } = build({ LEGAL_GATE_ENFORCED: 'false' }, () =>
      Promise.resolve(false),
    );

    expect(await guard.canActivate(contextFor(GATED))).toBe(true);
    expect(service.isValidated).not.toHaveBeenCalled();
  });

  it('unset: enforced in production, open in development and test', async () => {
    const prod = build({ NODE_ENV: 'production' }, () => Promise.resolve(false));
    await expect(prod.guard.canActivate(contextFor(GATED))).rejects.toBeInstanceOf(DomainError);
    for (const NODE_ENV of ['development', 'test']) {
      const open = build({ NODE_ENV }, () => Promise.resolve(false));
      expect(await open.guard.canActivate(contextFor(GATED))).toBe(true);
    }
  });

  it('an explicit false opens production, an explicit true closes development', async () => {
    const off = build({ NODE_ENV: 'production', LEGAL_GATE_ENFORCED: 'false' }, () =>
      Promise.resolve(false),
    );
    expect(await off.guard.canActivate(contextFor(GATED))).toBe(true);
    const on = build({ NODE_ENV: 'development', LEGAL_GATE_ENFORCED: 'true' }, () =>
      Promise.resolve(false),
    );
    await expect(on.guard.canActivate(contextFor(GATED))).rejects.toBeInstanceOf(DomainError);
  });
});

describe('it fails closed', () => {
  it('refuses when the validation cannot be read, and logs the code only', async () => {
    const logger = spyOnLogger();
    const { guard } = build({ LEGAL_GATE_ENFORCED: 'true' }, () =>
      Promise.reject(new TypeError('mongodb://user:secret@host is down')),
    );

    await expect(guard.canActivate(contextFor(GATED))).rejects.toEqual(
      new DomainError('LEGAL_VALIDATION_REQUIRED', { scope: 'third-party-processing' }),
    );
    expect(logger.loggedText()).toContain('TypeError');
    expect(logger.loggedText()).not.toContain('secret');
  });

  it('is a fault, never an open route, when used without the decorator', async () => {
    const { guard } = build({ LEGAL_GATE_ENFORCED: 'true' }, () => Promise.resolve(true));

    await expect(guard.canActivate(contextFor(Probe.prototype.plain))).rejects.toThrow(
      'without a scope',
    );
  });
});

describe('the decorator', () => {
  it('records the scope, the guard and the access requirement that overrides @Public() (SC-07)', () => {
    const reflector = new Reflector();
    expect(reflector.get<string>(REQUIRED_LEGAL_VALIDATION, GATED)).toBe('third-party-processing');
    expect(reflector.get<boolean>('auth:requires-access', GATED)).toBe(true);
    expect(Reflect.getMetadata('__guards__', GATED)).toContain(LegalValidationGuard);
  });
});
