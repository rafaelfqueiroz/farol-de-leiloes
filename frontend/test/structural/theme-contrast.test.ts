import { describe, expect, it } from 'vitest';
import {
  colorTokens,
  textPairs,
  uiPairs,
  type ColorTokenName,
  type SchemeName,
} from '@/app/theme/tokens';
import { schemePalette, schemes, valueAt } from './scheme-palette';

// WCAG 2.1 relative luminance of an sRGB hex colour.
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`not an opaque #RRGGBB colour: ${hex}`);
  const [r, g, b] = match.slice(1).map((channel) => {
    const c = parseInt(channel, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

function themeColor(name: ColorTokenName, scheme: SchemeName): string {
  const value = valueAt(schemePalette(scheme), colorTokens[name].path);
  if (typeof value !== 'string') throw new Error(`${name} missing from the ${scheme} palette`);
  return value;
}

type Case = [SchemeName, ColorTokenName, ColorTokenName, number];

function cases(pairs: typeof textPairs, minimum: number): Case[] {
  return schemes.flatMap((scheme) =>
    (Object.entries(pairs) as [ColorTokenName, readonly ColorTokenName[]][]).flatMap(
      ([fg, grounds]) => grounds.map((bg): Case => [scheme, fg, bg, minimum]),
    ),
  );
}

// DS-08: contrast is measured from the theme, in both schemes (WCAG 2.1 AA, BR-003-14)
describe('DS-08 contrast', () => {
  it.each([...cases(textPairs, 4.5), ...cases(uiPairs, 3)])(
    '%s: %s on %s is at least %d:1',
    (scheme, fg, bg, minimum) => {
      expect(contrast(themeColor(fg, scheme), themeColor(bg, scheme))).toBeGreaterThanOrEqual(
        minimum,
      );
    },
  );
});
