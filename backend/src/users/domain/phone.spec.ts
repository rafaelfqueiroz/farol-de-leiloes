// BR-001-27, AC "(84) 99999-1234 is accepted, a number without area code is rejected". The
// expectations are written out by hand (TS-04): DDD + subscriber number, prefixed by +55.
import { describe, expect, it } from 'vitest';
import { normalizeBrazilianPhone } from './phone.js';

describe('normalizeBrazilianPhone', () => {
  it.each([
    // mobile: DDD 84 + 9 digits starting with 9
    ['(84) 99999-1234', '+5584999991234'],
    ['84999991234', '+5584999991234'],
    ['+55 84 99999-1234', '+5584999991234'],
    ['+5584999991234', '+5584999991234'],
    ['5584999991234', '+5584999991234'], // country code without the plus: 13 digits
    // landline: DDD 84 + 8 digits starting 2-5
    ['(84) 3222-1234', '+558432221234'],
    ['8432221234', '+558432221234'],
    ['558432221234', '+558432221234'], // country code without the plus: 12 digits
    ['(11) 5555-0000', '+551155550000'], // 5 is the top of the landline range
    ['(11) 2555-0000', '+551125550000'], // 2 is the bottom
    ['  84.99999.1234 ', '+5584999991234'], // dots and surrounding space
    // DDD 55 (Rio Grande do Sul) is not mistaken for the country code: 11 digits
    ['55 99999-1234', '+5555999991234'],
    ['(55) 3222-1234', '+555532221234'],
  ])('accepts %s as %s', (input, expected) => {
    expect(normalizeBrazilianPhone(input)).toBe(expected);
  });

  it('is idempotent on its own output', () => {
    expect(normalizeBrazilianPhone('+5584999991234')).toBe('+5584999991234');
  });

  it.each([
    ['no area code, mobile', '99999-1234'],
    ['no area code, landline', '3222-1234'],
    ['too short', '(84) 9999-123'],
    ['too long', '(84) 99999-12345'],
    ['a 14-digit number', '55849999912345'],
    ['an unassigned DDD (10)', '(10) 99999-1234'],
    ['an unassigned DDD (20)', '(20) 3222-1234'],
    ['an unassigned DDD (00)', '(00) 99999-1234'],
    ['a 9-digit number that does not start with 9', '(84) 89999-1234'],
    ['an 8-digit mobile in the old style (starts with 9)', '(84) 9999-1234'],
    ['a landline starting with 1', '(84) 1222-1234'],
    ['a landline starting with 6', '(84) 6222-1234'],
    ['a foreign country code', '+1 202 555 0123'],
    ['a foreign country code after the plus', '+351 912 345 678'],
    ['letters', '(84) 9999A-1234'],
    ['letters only', 'telefone'],
    ['a plus in the middle', '84+999991234'],
    ['a lone plus', '+'],
    ['an empty string', ''],
    ['only separators', ' () - '],
  ])('rejects %s', (_label, input) => {
    expect(normalizeBrazilianPhone(input)).toBeNull();
  });

  it('accepts exactly the 67 assigned area codes', () => {
    const accepted = [];
    for (let ddd = 0; ddd < 100; ddd += 1) {
      const code = String(ddd).padStart(2, '0');
      if (normalizeBrazilianPhone(`${code}999991234`) !== null) accepted.push(code);
    }
    // 9 (11-19) + 5 (21 22 24 27 28) + 7 (31-35 37 38) + 9 (41-49) + 4 (51 53 54 55)
    // + 9 (61-69) + 6 (71 73 74 75 77 79) + 9 (81-89) + 9 (91-99) = 67
    expect(accepted).toHaveLength(67);
    expect(accepted.slice(0, 3)).toEqual(['11', '12', '13']);
    expect(accepted).not.toContain('23');
    expect(accepted).toContain('79');
    expect(accepted).not.toContain('72');
  });
});
