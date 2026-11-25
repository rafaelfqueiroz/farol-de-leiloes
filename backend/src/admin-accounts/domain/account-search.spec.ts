import { describe, expect, it } from 'vitest';
import { normaliseSearchTerms, SEARCH_LENGTH, searchKindOf } from './account-search.js';

describe('BR-009-13: normalising the terms of an account search', () => {
  it('lower-cases and trims', () => {
    expect(normaliseSearchTerms('  Maria SILVA  ')).toBe('maria silva');
  });

  it('collapses every run of whitespace, tabs and line breaks included, to one space', () => {
    expect(normaliseSearchTerms('maria \t\n  silva')).toBe('maria silva');
  });

  it('applies NFKC: a full-width or ligature spelling is the plain one', () => {
    expect(normaliseSearchTerms('ＭＡＲＩＡ')).toBe('maria');
    expect(normaliseSearchTerms('ﬁlho')).toBe('filho');
  });

  it('turns two ways of typing the same search into one value', () => {
    expect(normaliseSearchTerms(' ANA@Exemplo.test ')).toBe(
      normaliseSearchTerms('ana@exemplo.test'),
    );
  });

  it('turns control characters, the NUL byte included, into spaces: the database refuses a pattern holding one', () => {
    expect(normaliseSearchTerms('abc\u0000def')).toBe('abc def');
    expect(normaliseSearchTerms('\u0001ana\u001f\u007f silva\u0000')).toBe('ana silva');
    expect(normaliseSearchTerms('\u0000\u0000\u0000')).toBe('');
  });

  it('leaves nothing for a text of only spaces', () => {
    expect(normaliseSearchTerms('   \t ')).toBe('');
  });
});

describe('BR-009-13: the kind of a search', () => {
  it('is an email search when the terms have an @, anywhere', () => {
    expect(searchKindOf('ana@exemplo.test')).toBe('email');
    expect(searchKindOf('@exemplo')).toBe('email');
    expect(searchKindOf('ana@')).toBe('email');
  });

  it('is a name search otherwise', () => {
    expect(searchKindOf('maria silva')).toBe('name');
    expect(searchKindOf('exemplo.test')).toBe('name');
  });

  it('holds the length limits 3 and 100', () => {
    expect(SEARCH_LENGTH).toEqual({ min: 3, max: 100 });
  });
});
