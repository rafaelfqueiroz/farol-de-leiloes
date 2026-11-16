// BR-001-13, BR-001-01, BR-001-02, BR-001-31: the request contracts of the auth endpoints, run
// through the same ValidationPipe settings the app uses (app.setup.ts).
import 'reflect-metadata';
import { ValidationPipe, type Type } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ChangePasswordDto } from './change-password.dto.js';
import { LoginDto } from './login.dto.js';
import { RegisterDto } from './register.dto.js';
import { RequestResetPasswordDto, ResetPasswordDto } from './reset-password.dto.js';
import { SetPasswordDto } from './set-password.dto.js';
import { VerifyEmailDto } from './verify-email.dto.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { propertyPaths } from '../../app.setup.js';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors) =>
    new DomainError('VALIDATION_FAILED', { fields: propertyPaths(errors) }),
});

function parse<T>(type: Type<T>, body: unknown): Promise<T> {
  return pipe.transform(body, { type: 'body', metatype: type });
}

async function failedFields<T>(type: Type<T>, body: unknown): Promise<string[]> {
  try {
    await parse(type, body);
  } catch (error) {
    return (error as DomainError).context['fields'] as string[];
  }
  return [];
}

const valid = {
  email: 'ana@example.test',
  password: 'twelve-chars',
  name: 'Ana',
  acceptTerms: true,
};

describe('RegisterDto', () => {
  it('BR-001-01: trims and lower-cases the email, and trims the name', async () => {
    const dto = await parse(RegisterDto, {
      ...valid,
      email: ' Ana@Example.TEST ',
      name: '  Ana  ',
    });

    expect(dto.email).toBe('ana@example.test');
    expect(dto.name).toBe('Ana');
  });

  it.each([
    ['7 characters', 'abcdefg', true],
    ['8 characters with no digit or symbol', 'abcdefgh', false],
    ['128 characters', 'a'.repeat(128), false],
    ['129 characters', 'a'.repeat(129), true],
  ])('BR-001-13: a password of %s', async (_label, password, rejected) => {
    const fields = await failedFields(RegisterDto, { ...valid, password });

    expect(fields).toEqual(rejected ? ['password'] : []);
  });

  it('BR-001-02: refuses a sign-up that declines the terms', async () => {
    expect(await failedFields(RegisterDto, { ...valid, acceptTerms: false })).toEqual([
      'acceptTerms',
    ]);
    // Transitional: absent is accepted until the frontend checkbox ships (PR 4 makes it required).
    const without: Partial<typeof valid> = { ...valid };
    delete without.acceptTerms;
    expect(await failedFields(RegisterDto, without)).toEqual([]);
    expect(await failedFields(RegisterDto, { ...valid, acceptTerms: 'true' })).toEqual([
      'acceptTerms',
    ]);
  });

  it.each(['role', 'plan', 'subscriptionStatus', 'emailVerified', 'providers', 'status'])(
    'BR-001-31: a body with %s is refused as a whole',
    async (field) => {
      expect(await failedFields(RegisterDto, { ...valid, [field]: 'admin' })).toEqual([field]);
    },
  );

  it('refuses a blank name', async () => {
    expect(await failedFields(RegisterDto, { ...valid, name: '   ' })).toEqual(['name']);
  });
});

describe('new-password fields', () => {
  it.each([
    ['ResetPasswordDto', ResetPasswordDto, { token: 'abc' }],
    ['ChangePasswordDto', ChangePasswordDto, { currentPassword: 'old' }],
    ['SetPasswordDto', SetPasswordDto, {}],
  ] as const)('BR-001-13: %s takes 8 to 128 characters', async (_name, type, rest) => {
    const body = (newPassword: string) => ({ ...rest, newPassword });

    expect(await failedFields(type as Type<unknown>, body('1234567'))).toEqual(['newPassword']);
    expect(await failedFields(type as Type<unknown>, body('abcdefgh'))).toEqual([]);
    expect(await failedFields(type as Type<unknown>, body('a'.repeat(129)))).toEqual([
      'newPassword',
    ]);
  });
});

describe('emails and tokens', () => {
  it.each([
    ['LoginDto', LoginDto, { password: 'x' }],
    ['RequestResetPasswordDto', RequestResetPasswordDto, {}],
  ] as const)('BR-001-01: %s normalises the email', async (_name, type, rest) => {
    const dto = (await parse(type as Type<{ email: string }>, {
      ...rest,
      email: ' Ana@Example.TEST',
    })) as { email: string };

    expect(dto.email).toBe('ana@example.test');
  });

  it('refuses a token that is not text or is oversized', async () => {
    expect(await failedFields(VerifyEmailDto, { token: { $ne: null } })).toEqual(['token']);
    expect(await failedFields(VerifyEmailDto, { token: 'a'.repeat(257) })).toEqual(['token']);
    expect(await failedFields(ResetPasswordDto, { token: '', newPassword: 'abcdefgh' })).toEqual([
      'token',
    ]);
  });
});
