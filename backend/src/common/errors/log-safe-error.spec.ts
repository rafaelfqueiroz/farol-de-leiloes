import { describe, expect, it } from 'vitest';
import { logSafeError } from './log-safe-error.js';

class ProviderError extends Error {
  constructor(
    message: string,
    readonly code?: unknown,
  ) {
    super(message);
  }
}

describe('logSafeError', () => {
  it('answers a string code', () => {
    expect(logSafeError(new ProviderError('to +5500000000000', 'EENVELOPE'))).toBe('EENVELOPE');
  });

  it('answers a numeric code as a string', () => {
    expect(logSafeError(new ProviderError('to +5500000000000', 21211))).toBe('21211');
  });

  it('falls back to the class name when the code is missing, empty or not a string or number', () => {
    expect(logSafeError(new ProviderError('x'))).toBe('ProviderError');
    expect(logSafeError(new ProviderError('x', ''))).toBe('ProviderError');
    expect(logSafeError(new ProviderError('x', NaN))).toBe('ProviderError');
    expect(logSafeError(new ProviderError('x', { a: 1 }))).toBe('ProviderError');
    expect(logSafeError(new TypeError('x'))).toBe('TypeError');
  });

  it('answers UNKNOWN_ERROR for a plain object, null, a primitive or a prototype-less object', () => {
    expect(logSafeError({ message: 'fulana@example.test' })).toBe('UNKNOWN_ERROR');
    expect(logSafeError(null)).toBe('UNKNOWN_ERROR');
    expect(logSafeError('fulana@example.test')).toBe('UNKNOWN_ERROR');
    expect(logSafeError(Object.create(null))).toBe('UNKNOWN_ERROR');
  });

  it('never includes the message', () => {
    expect(logSafeError(new Error('fulana@example.test'))).not.toContain('fulana');
  });
});
