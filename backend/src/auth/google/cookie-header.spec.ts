import { describe, expect, it } from 'vitest';
import { readCookie } from './cookie-header.js';

describe('readCookie', () => {
  it.each([
    ['no header', undefined, undefined],
    ['an empty header', '', undefined],
    ['the cookie alone', 'a=1', '1'],
    ['among others, with spaces', 'x=9; a=1 ;  y=8', '1'],
    ['a value holding "=" and "."', 'a=abc.def==', 'abc.def=='],
    ['a quoted value', 'a="quoted"', 'quoted'],
    ['an empty value', 'a=', ''],
    ['the first of two with the same name', 'a=first; a=second', 'first'],
  ])('%s', (_label, header, expected) => {
    expect(readCookie(header, 'a')).toBe(expected);
  });

  it.each([
    ['another name', 'b=1'],
    ['a name that only ends like it', 'xa=1'],
    ['a name that only starts like it', 'ab=1'],
    ['a pair without "="', 'a'],
    ['the name inside a value', 'b=a=1'],
  ])('does not take %s for the cookie', (_label, header) => {
    expect(readCookie(header, 'a')).toBeUndefined();
  });
});
