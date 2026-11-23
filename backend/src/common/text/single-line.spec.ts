// SPEC-009 BR-009-05: a one-line field has no line break, control or bidi character. Hand-computed (TS-04).
import { describe, expect, it } from 'vitest';
import { singleLine } from './single-line.js';

describe('singleLine', () => {
  it('turns every kind of line break into one space', () => {
    expect(singleLine('a\nb\r\nc\rd\u2028e\u2029f')).toBe('a b c d e f');
  });

  it('turns controls (C0, DEL, C1) and bidi marks, embeddings, overrides and isolates into spaces', () => {
    expect(
      singleLine(
        'a\u0000b\u0007c\u007Fd\u0085e\u200Ef\u200Fg\u061Ch\u202Ai\u202Bj\u202Ck\u202Dl\u202Em\u2066n\u2067o\u2068p\u2069q',
      ),
    ).toBe('a b c d e f g h i j k l m n o p q');
  });

  it('collapses runs of white space and trims the ends', () => {
    expect(singleLine('  um   dois\t\ttrês  ')).toBe('um dois três');
  });

  it('leaves plain text, accents and emoji alone, and an empty or all-unsafe text becomes empty', () => {
    expect(singleLine('Não consigo entrar 😀')).toBe('Não consigo entrar 😀');
    expect(singleLine('')).toBe('');
    expect(singleLine('\n\u202E\u0007\n')).toBe('');
  });
});
