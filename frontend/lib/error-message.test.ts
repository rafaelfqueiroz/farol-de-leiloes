import { describe, expect, it } from 'vitest';
import { errorMessage } from './error-message';

describe('errorMessage', () => {
  it('reads the message of an Error', () => {
    expect(errorMessage(new Error('Credenciais invalidas'))).toBe('Credenciais invalidas');
  });

  it('reads the message of a plain object, such as a parsed backend error body', () => {
    expect(errorMessage({ message: 'Cupom invalido', statusCode: 400 })).toBe('Cupom invalido');
  });

  it('returns an empty string when nothing carries a message', () => {
    expect(errorMessage(undefined)).toBe('');
    expect(errorMessage(null)).toBe('');
    expect(errorMessage('a string')).toBe('');
    expect(errorMessage({})).toBe('');
  });

  it('ignores a message that is not a string, such as a validation error list', () => {
    expect(errorMessage({ message: ['name must not be empty'] })).toBe('');
  });
});
