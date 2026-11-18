import { describe, expect, it } from 'vitest';
import { safeNextPath } from './safe-redirect';

describe('safeNextPath', () => {
  it.each(['/plans', '/search?view=favorites', '/office/plan', '/'])('follows %s', (path) => {
    expect(safeNextPath(path)).toBe(path);
  });

  it.each([
    null,
    '',
    'plans',
    '//evil.example',
    '//evil',
    '/\\evil.example',
    '/\\evil',
    '/\t/evil',
    '/plans\n',
    '/plans\r\n',
    '/ /evil',
    '/ plans',
    '/@evil',
    '/%2f%2fevil',
    '/%2F%2Fevil',
    '/%5cevil',
    '/plans%0d%0a',
    'https://evil.example/plans',
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,x',
    '/plans#x',
    '/api',
    '/api/',
    '/api/auth/logout',
    '/API/auth/logout',
    '/api?x=1',
    '/../etc/passwd',
    '/plans/../api/auth/logout',
    `/${'a'.repeat(200)}`,
    'a'.repeat(5000),
  ])('refuses %j', (path) => {
    expect(safeNextPath(path)).toBeNull();
  });

  it('allows a path that merely starts like /api', () => {
    expect(safeNextPath('/apiary')).toBe('/apiary');
    expect(safeNextPath('/.well-known/x')).toBe('/.well-known/x');
  });
});
