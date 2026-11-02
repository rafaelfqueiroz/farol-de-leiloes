import { errorMessage } from '../src/common/error-message';

describe('errorMessage', () => {
  it('uses the message of an Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom');
  });

  it('uses a non-empty message property of any object', () => {
    expect(errorMessage({ message: 'from a plain object' })).toBe('from a plain object');
  });

  it.each([
    ['a string', 'raw failure', 'raw failure'],
    ['undefined', undefined, 'undefined'],
    ['null', null, 'null'],
    ['an Error without a message', new Error(''), 'Error'],
    ['a non-string message', { message: 42 }, '[object Object]'],
  ])('stringifies %s like a template literal would', (_label, value, expected) => {
    expect(errorMessage(value)).toBe(expected);
  });
});
