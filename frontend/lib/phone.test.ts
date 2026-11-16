import { describe, expect, it } from 'vitest';
import { formatPhone } from './phone';

// hand-computed: area code 84, then 5 + 4 digits (mobile) or 4 + 4 digits (landline)
describe('formatPhone', () => {
  it.each([
    ['+5584999991234', '(84) 99999-1234'],
    ['+558432221234', '(84) 3222-1234'],
    ['+5511987654321', '(11) 98765-4321'],
    ['+551133334444', '(11) 3333-4444'],
  ])('shows the E.164 %s as %s', (stored, shown) => {
    expect(formatPhone(stored)).toBe(shown);
  });

  it('leaves an already formatted number as it is', () => {
    expect(formatPhone('(84) 99999-1234')).toBe('(84) 99999-1234');
    expect(formatPhone('(84) 3222-1234')).toBe('(84) 3222-1234');
  });

  it.each([null, undefined, ''])('turns %j into an empty string', (empty) => {
    expect(formatPhone(empty)).toBe('');
  });

  it.each(['+14155552671', '+55 84 99999-1234', '+55849999123', '+55849999912345', 'telefone'])(
    'returns %s unchanged: not a Brazilian E.164 number of 10 or 11 digits',
    (other) => {
      expect(formatPhone(other)).toBe(other);
    },
  );
});
