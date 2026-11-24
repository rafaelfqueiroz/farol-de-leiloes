import { describe, expect, it } from 'vitest';
import { escapeRegex } from './escape-regex.js';

describe('SC-10 escapeRegex', () => {
  it('leaves plain text, digits, spaces, "@" and accented letters alone', () => {
    expect(escapeRegex('ana silva 42@exemplo')).toBe('ana silva 42@exemplo');
    expect(escapeRegex('joão')).toBe('joão');
  });

  it.each([
    ['.', '\\.'],
    ['*', '\\*'],
    ['+', '\\+'],
    ['?', '\\?'],
    ['^', '\\^'],
    ['$', '\\$'],
    ['{', '\\{'],
    ['}', '\\}'],
    ['(', '\\('],
    [')', '\\)'],
    ['|', '\\|'],
    ['[', '\\['],
    [']', '\\]'],
    ['\\', '\\\\'],
    ['/', '\\/'],
    ['-', '\\-'],
  ])('escapes %s', (character, escaped) => {
    expect(escapeRegex(character)).toBe(escaped);
  });

  it('turns a pattern meant to match everything into one that matches only itself', () => {
    const pattern = new RegExp(escapeRegex('.*'), 'i');

    expect(pattern.test('qualquer coisa')).toBe(false);
    expect(pattern.test('antes .* depois')).toBe(true);
  });

  it('a catastrophic-backtracking pattern is literal text too, so it matches by plain comparison', () => {
    const typed = '(a+)+$';
    const pattern = new RegExp(escapeRegex(typed), 'i');

    expect(pattern.test('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!')).toBe(false);
    expect(pattern.test(`x${typed}y`)).toBe(true);
  });
});
