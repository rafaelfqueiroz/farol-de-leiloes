// SPEC-010 BR-010-25: `LEGAL_GATE_ENFORCED=false` in production is allowed but never silent.
import { describe, expect, it } from 'vitest';
import { spyOnLogger } from '../../../test/support/logger-spy.js';
import { testConfigService } from '../../../test/support/test-env.js';
import { LegalValidationModule } from './legal-validation.module.js';

const boot = (env: Record<string, string>) =>
  new LegalValidationModule(testConfigService(env)).onModuleInit();

describe('LegalValidationModule.onModuleInit', () => {
  it('warns at boot when the gate is switched off in production', () => {
    const logger = spyOnLogger();

    boot({ NODE_ENV: 'production', LEGAL_GATE_ENFORCED: 'false' });

    expect(logger.loggedText()).toContain('LEGAL_GATE_ENFORCED is false in production');
  });

  it.each([
    ['production, flag unset (enforced)', { NODE_ENV: 'production' }],
    ['production, flag true', { NODE_ENV: 'production', LEGAL_GATE_ENFORCED: 'true' }],
    ['development, flag false', { NODE_ENV: 'development', LEGAL_GATE_ENFORCED: 'false' }],
    ['test, flag unset', { NODE_ENV: 'test' }],
  ])('says nothing for %s', (_label, env) => {
    const logger = spyOnLogger();

    boot(env);

    expect(logger.loggedText()).toBe('');
  });
});
