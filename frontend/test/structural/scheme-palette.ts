import type { CssVarsTheme } from '@mui/material/styles';
import { theme } from '@/app/theme/theme';
import type { SchemeName } from '@/app/theme/tokens';

export const schemes: readonly SchemeName[] = ['light', 'dark'];

// Reads the palette the built theme actually ships, so a drift between tokens and theme fails.
export function schemePalette(scheme: SchemeName): Record<string, unknown> {
  // createTheme is typed as Theme; with `cssVariables` it is a CssVarsTheme at runtime
  const palette = (theme as unknown as CssVarsTheme).colorSchemes[scheme]?.palette;
  if (!palette) throw new Error(`theme has no ${scheme} colour scheme`);
  return palette as unknown as Record<string, unknown>;
}

export function valueAt(palette: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node === null || typeof node !== 'object') return undefined;
    return (node as Record<string, unknown>)[key];
  }, palette);
}
