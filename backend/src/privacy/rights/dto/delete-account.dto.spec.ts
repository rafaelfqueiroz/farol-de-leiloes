// SPEC-010 BR-010-13: the closure request carries exactly one proof and a confirmation (AR-34).
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../../common/errors/domain-error.js';
import { AccountClosureResponseDto, DeleteAccountDto } from './delete-account.dto.js';

const build = (plain: Record<string, unknown>) => plainToInstance(DeleteAccountDto, plain);
const fieldsWithErrors = async (plain: Record<string, unknown>) =>
  (await validate(build(plain), { whitelist: true, forbidNonWhitelisted: true })).map(
    (e) => e.property,
  );

describe('DeleteAccountDto', () => {
  it('accepts a password with the confirmation, or a Google code with it', async () => {
    expect(await fieldsWithErrors({ password: 'p', confirm: true })).toEqual([]);
    expect(await fieldsWithErrors({ googleCode: 'c', confirm: true })).toEqual([]);
  });

  it.each([
    ['no confirmation', { password: 'p' }, 'confirm'],
    ['a confirmation that is false', { password: 'p', confirm: false }, 'confirm'],
    ['an empty password', { password: '', confirm: true }, 'password'],
    ['an empty Google code', { googleCode: '', confirm: true }, 'googleCode'],
    [
      'a property outside the DTO (BR-002-11)',
      { password: 'p', confirm: true, userId: 'x' },
      'userId',
    ],
  ])('refuses %s', async (_label, plain, field) => {
    expect(await fieldsWithErrors(plain)).toContain(field);
  });

  it('proof() is the password, or the Google code, never both or none', () => {
    expect(build({ password: 'p', confirm: true }).proof()).toEqual({ password: 'p' });
    expect(build({ googleCode: 'c', confirm: true }).proof()).toEqual({ googleCode: 'c' });
    for (const plain of [{ confirm: true }, { password: 'p', googleCode: 'c', confirm: true }]) {
      expect(() => build(plain).proof()).toThrow(DomainError);
    }
  });

  it('answers closed: true', () => {
    expect(new AccountClosureResponseDto()).toEqual({ closed: true });
  });
});
