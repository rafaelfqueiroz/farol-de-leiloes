import { describe, expect, it } from 'vitest';
import { colorTokens, type ColorToken } from '@/app/theme/tokens';
import { schemePalette, schemes, valueAt } from './scheme-palette';

function leafPaths(node: unknown, prefix = ''): string[] {
  if (node === null || typeof node !== 'object') return [prefix];
  return Object.entries(node as Record<string, unknown>)
    .filter(([, value]) => typeof value !== 'function')
    .flatMap(([key, value]) => leafPaths(value, prefix ? `${prefix}.${key}` : key))
    .sort();
}

// DS-05: every token is defined in both colour schemes
// MUI adds a few mode-only keys of its own (AppBar.darkBg, text.icon); the project's groups and
// every token path must match exactly.
const projectGroups = ['destructive', 'figure', 'status', 'border', 'focus', 'overlay'];

describe('DS-05 colour schemes', () => {
  it.each(projectGroups)('%s has identical keys in light and dark', (group) => {
    const keys = (scheme: 'light' | 'dark') => leafPaths(valueAt(schemePalette(scheme), group));
    expect(keys('dark')).toEqual(keys('light'));
  });

  const tokens = Object.entries(colorTokens) as [string, ColorToken][];

  it.each(tokens)('%s is set from its token in both schemes', (_, token) => {
    for (const scheme of schemes) {
      expect(valueAt(schemePalette(scheme), token.path)).toBe(token[scheme]);
    }
  });
});
