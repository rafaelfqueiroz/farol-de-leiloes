// SPEC-009 BR-009-13, BR-009-15, BR-009-17, BR-009-21 (AR-34): the request contracts of the account
// administration, run through the ValidationPipe settings the app uses (app.setup.ts): the whitelist
// refuses any field the DTO does not name, which is what keeps the admin from editing an account.
import 'reflect-metadata';
import { ValidationPipe, type Type } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { propertyPaths } from '../../app.setup.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { signInMethodsOf } from './account-record.dto.js';
import { AccountSearchQueryDto } from './account-search-query.dto.js';
import { DeactivateAccountDto, ReactivateAccountDto } from './account-status-change.dto.js';

const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  exceptionFactory: (errors) =>
    new DomainError('VALIDATION_FAILED', { fields: propertyPaths(errors) }),
});

function parse<T>(type: Type<T>, value: unknown, kind: 'body' | 'query' = 'body'): Promise<T> {
  return pipe.transform(value, { type: kind, metatype: type });
}

async function failedFields<T>(type: Type<T>, value: unknown, kind: 'body' | 'query' = 'body') {
  try {
    await parse(type, value, kind);
  } catch (error) {
    return (error as DomainError).context['fields'] as string[];
  }
  return [];
}

describe('AccountSearchQueryDto (BR-009-13)', () => {
  it('normalises the terms before measuring them: trimmed, lower-cased, spaces collapsed, NFKC', async () => {
    const query = await parse(AccountSearchQueryDto, { q: '  ＭARIA   Silva ' }, 'query');

    expect(query.q).toBe('maria silva');
    expect([query.page, query.pageSize]).toEqual([1, 20]);
  });

  it.each([
    ['2 characters', { q: 'ab' }],
    ['2 characters after trimming', { q: '  ab  ' }],
    ['101 characters', { q: 'a'.repeat(101) }],
    ['no terms', {}],
    ['an object', { q: { $ne: 'zzz' } }],
    ['a page of 101', { q: 'abc', pageSize: '101' }],
    ['page 0', { q: 'abc', page: '0' }],
    ['another parameter', { q: 'abc', role: 'admin' }],
  ])('refuses %s', async (_label, value) => {
    expect((await failedFields(AccountSearchQueryDto, value, 'query')).length).toBeGreaterThan(0);
  });

  it('accepts exactly 3 and exactly 100 characters', async () => {
    await expect(parse(AccountSearchQueryDto, { q: 'abc' }, 'query')).resolves.toBeDefined();
    await expect(
      parse(AccountSearchQueryDto, { q: 'a'.repeat(100) }, 'query'),
    ).resolves.toBeDefined();
  });
});

describe('DeactivateAccountDto (BR-009-15, BR-009-21)', () => {
  it('takes a reason of 3 to 500 characters, as one line', async () => {
    expect((await parse(DeactivateAccountDto, { reason: ' a\nb\tc ' })).reason).toBe('a b c');
    await expect(parse(DeactivateAccountDto, { reason: 'abc' })).resolves.toBeDefined();
    await expect(parse(DeactivateAccountDto, { reason: 'a'.repeat(500) })).resolves.toBeDefined();
  });

  it.each([{}, { reason: 'ab' }, { reason: '   ' }, { reason: 'a'.repeat(501) }, { reason: 5 }])(
    'refuses %j',
    async (body) => {
      expect(await failedFields(DeactivateAccountDto, body)).toEqual(['reason']);
    },
  );

  it.each([
    'name',
    'email',
    'phone',
    'personas',
    'memberships',
    'plan',
    'status',
    'isAdmin',
    'userId',
  ])('BR-009-21: refuses a body that also names %s', async (field) => {
    expect(await failedFields(DeactivateAccountDto, { reason: 'um motivo', [field]: 'x' })).toEqual(
      [field],
    );
  });
});

describe('ReactivateAccountDto (BR-009-17, BR-009-21)', () => {
  it('takes no body, or an optional note of up to 500 characters', async () => {
    await expect(parse(ReactivateAccountDto, {})).resolves.toEqual({});
    await expect(parse(ReactivateAccountDto, { note: 'a'.repeat(500) })).resolves.toBeDefined();
    expect(await failedFields(ReactivateAccountDto, { note: 'a'.repeat(501) })).toEqual(['note']);
  });

  it('refuses any other field', async () => {
    expect(await failedFields(ReactivateAccountDto, { note: 'x', email: 'a@b.test' })).toEqual([
      'email',
    ]);
  });
});

describe('signInMethodsOf (BR-009-13)', () => {
  it.each([
    [['local'], ['password']],
    [['google'], ['google']],
    [
      ['local', 'google'],
      ['password', 'google'],
    ],
    [
      ['google', 'local'],
      ['password', 'google'],
    ],
    [[], []],
    [['facebook'], []],
  ])('%j is %j', (providers, methods) => {
    expect(signInMethodsOf(providers)).toEqual(methods);
  });
});
