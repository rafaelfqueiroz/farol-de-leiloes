import { describe, expect, it } from 'vitest';
import { deleteAccountBody } from './delete-account-form';

describe('deleteAccountBody (BR-010-13)', () => {
  it('builds the request with the password as the one proof, and the confirmation', () => {
    expect(
      deleteAccountBody({ method: 'password', password: 'segredo', acknowledged: true }),
    ).toEqual({
      ok: true,
      body: { password: 'segredo', confirm: true },
    });
  });

  it('builds the request with the Google code as the one proof, never both', () => {
    const result = deleteAccountBody({ method: 'google', googleCode: 'abc', acknowledged: true });

    expect(result).toEqual({ ok: true, body: { googleCode: 'abc', confirm: true } });
    expect(result.ok && 'password' in result.body).toBe(false);
  });

  it.each([
    [
      'an empty password',
      { method: 'password', password: '', acknowledged: true },
      'passwordRequired',
    ],
    [
      'no Google confirmation yet',
      { method: 'google', googleCode: '', acknowledged: true },
      'googleRequired',
    ],
    [
      'an unticked box with a password',
      { method: 'password', password: 'x', acknowledged: false },
      'acknowledgeRequired',
    ],
    [
      'an unticked box with a Google code',
      { method: 'google', googleCode: 'x', acknowledged: false },
      'acknowledgeRequired',
    ],
  ] as const)('sends nothing for %s', (_label, values, error) => {
    expect(deleteAccountBody(values)).toEqual({ ok: false, error });
  });

  it('does not trim the password: it is what the person typed', () => {
    expect(deleteAccountBody({ method: 'password', password: ' x ', acknowledged: true })).toEqual({
      ok: true,
      body: { password: ' x ', confirm: true },
    });
  });
});
