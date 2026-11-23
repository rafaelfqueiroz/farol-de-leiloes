import { describe, expect, it } from 'vitest';
import { registerFormErrors, type RegisterFormValues } from './register-form';

const valid: RegisterFormValues = {
  name: 'Ana Souza',
  email: 'ana@exemplo.com.br',
  password: 'uma-senha-longa',
  confirmPassword: 'uma-senha-longa',
  acceptTerms: true,
  whatsappConsent: false,
};

describe('registerFormErrors', () => {
  it('accepts a complete form, with the WhatsApp box either way', () => {
    expect(registerFormErrors(valid)).toEqual({});
    expect(registerFormErrors({ ...valid, whatsappConsent: true })).toEqual({});
  });

  it('BR-010-01: refuses the form until the terms are accepted', () => {
    expect(registerFormErrors({ ...valid, acceptTerms: false })).toEqual({
      acceptTerms: 'termsRequired',
    });
  });

  it('BR-010-27: never requires the WhatsApp box', () => {
    expect(registerFormErrors({ ...valid, whatsappConsent: false })).not.toHaveProperty(
      'whatsappConsent',
    );
  });

  it.each([
    ['7 characters', 'a'.repeat(7)],
    ['129 characters', 'a'.repeat(129)],
  ])('BR-001-13: refuses a password of %s', (_label, password) => {
    expect(registerFormErrors({ ...valid, password, confirmPassword: password })).toEqual({
      password: 'passwordLength',
    });
  });

  it('BR-001-13: accepts the limits, 8 and 128 characters', () => {
    for (const length of [8, 128]) {
      const password = 'a'.repeat(length);
      expect(registerFormErrors({ ...valid, password, confirmPassword: password })).toEqual({});
    }
  });

  it('asks for the confirmation to match', () => {
    expect(registerFormErrors({ ...valid, confirmPassword: 'outra-senha-longa' })).toEqual({
      confirmPassword: 'passwordMismatch',
    });
  });

  it('reports every broken field at once, the first message of each', () => {
    expect(
      registerFormErrors({ ...valid, name: ' ', email: '', password: 'x', acceptTerms: false }),
    ).toEqual({
      name: 'required',
      email: 'required',
      password: 'passwordLength',
      confirmPassword: 'passwordMismatch',
      acceptTerms: 'termsRequired',
    });
  });
});
