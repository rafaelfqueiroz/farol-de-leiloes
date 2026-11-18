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
    '/\\evil.example',
    'https://evil.example/plans',
    'javascript:alert(1)',
    '/plans#x',
    `/${'a'.repeat(200)}`,
  ])('refuses %s', (path) => {
    expect(safeNextPath(path)).toBeNull();
  });
});
