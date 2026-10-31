// Raw design tokens (DESIGN.md §2). DS-04: only `app/theme/` and the structural tests import
// this file; components read the theme (`sx`, `theme.vars.*`), never these constants.

export type SchemeName = 'light' | 'dark';

export interface ColorToken {
  light: string;
  dark: string;
  /** Where the token lives in the MUI palette (`theme.palette.<path>`). */
  path: string;
}

export const colorTokens = {
  // surfaces
  bg: { light: '#F5F7FA', dark: '#0B1422', path: 'background.default' },
  surface: { light: '#FFFFFF', dark: '#111D2E', path: 'background.paper' },
  'surface-raised': { light: '#FFFFFF', dark: '#172638', path: 'background.raised' },
  'surface-muted': { light: '#EDF1F5', dark: '#1B2B40', path: 'background.muted' },
  overlay: { light: 'rgba(15, 27, 43, 0.48)', dark: 'rgba(0, 0, 0, 0.64)', path: 'overlay' },
  // text
  ink: { light: '#0F1B2B', dark: '#E6EDF5', path: 'text.primary' },
  'ink-muted': { light: '#4A5A70', dark: '#A9B6C7', path: 'text.secondary' },
  'ink-disabled': { light: '#8A97A8', dark: '#6B7A8F', path: 'text.disabled' },
  // lines
  line: { light: '#E3E8EF', dark: '#24344A', path: 'divider' },
  'line-strong': { light: '#7A879A', dark: '#6B7A8F', path: 'border.control' },
  // brand
  primary: { light: '#1D3B63', dark: '#8DB4E8', path: 'primary.main' },
  'primary-hover': { light: '#142B4A', dark: '#B5CFF0', path: 'primary.dark' },
  'primary-soft': { light: '#E8EEF6', dark: '#1B3050', path: 'primary.soft' },
  'on-primary': { light: '#FFFFFF', dark: '#0B1422', path: 'primary.contrastText' },
  accent: { light: '#E5A50A', dark: '#F2BE3D', path: 'secondary.main' },
  'accent-hover': { light: '#B98300', dark: '#F5CF63', path: 'secondary.dark' },
  'accent-soft': { light: '#FDF3D7', dark: '#3A2E0E', path: 'secondary.soft' },
  'accent-ink': { light: '#8A5F00', dark: '#F2BE3D', path: 'secondary.ink' },
  'on-accent': { light: '#0F1B2B', dark: '#0B1422', path: 'secondary.contrastText' },
  // `{primary}` in DESIGN.md: the focus ring is the brand colour in each scheme
  focus: { light: '#1D3B63', dark: '#8DB4E8', path: 'focus' },
  // feedback
  error: { light: '#B42318', dark: '#F28B82', path: 'error.main' },
  'error-soft': { light: '#FDECEA', dark: '#3D1C1A', path: 'error.soft' },
  warning: { light: '#A04A05', dark: '#F5B76B', path: 'warning.main' },
  'warning-soft': { light: '#FEF4E6', dark: '#3A2A12', path: 'warning.soft' },
  info: { light: '#22598F', dark: '#7CB8F0', path: 'info.main' },
  'info-soft': { light: '#E8F0FA', dark: '#13283F', path: 'info.soft' },
  success: { light: '#1E7A4C', dark: '#6FCF97', path: 'success.main' },
  'success-soft': { light: '#E6F4EC', dark: '#13321F', path: 'success.soft' },
  // project additions (DS-06: chosen by meaning, even where hues coincide)
  destructive: { light: '#B42318', dark: '#F28B82', path: 'destructive.main' },
  'destructive-hover': { light: '#8F1C13', dark: '#F5A097', path: 'destructive.dark' },
  'on-destructive': { light: '#FFFFFF', dark: '#0B1422', path: 'destructive.contrastText' },
  'figure-positive': { light: '#1E7A4C', dark: '#6FCF97', path: 'figure.positive' },
  'figure-negative': { light: '#B42318', dark: '#F28B82', path: 'figure.negative' },
  'status-on-time': { light: '#1E6B45', dark: '#8FD9AE', path: 'status.onTime' },
  'status-on-time-surface': { light: '#E4F2EA', dark: '#16352A', path: 'status.onTimeSurface' },
  'status-late': { light: '#A4281C', dark: '#F5A097', path: 'status.late' },
  'status-late-surface': { light: '#FBE9E7', dark: '#3D1C1A', path: 'status.lateSurface' },
  'status-done': { light: '#0E5C66', dark: '#7FD0D8', path: 'status.done' },
  'status-done-surface': { light: '#E0F1F2', dark: '#123438', path: 'status.doneSurface' },
  'status-cancelled': { light: '#4A5568', dark: '#B6C2D1', path: 'status.cancelled' },
  'status-cancelled-surface': {
    light: '#EEF1F5',
    dark: '#222E3D',
    path: 'status.cancelledSurface',
  },
  'status-neutral': { light: '#364152', dark: '#D5DCE6', path: 'status.neutral' },
  'status-neutral-surface': { light: '#E3E8EF', dark: '#2A3A50', path: 'status.neutralSurface' },
} as const satisfies Record<string, ColorToken>;

export type ColorTokenName = keyof typeof colorTokens;

export function colorToken(name: ColorTokenName, scheme: SchemeName): string {
  return colorTokens[name][scheme];
}

// DS-08: the contrast promises. Text tokens -> grounds they are used on, checked at 4.5:1.
export const textPairs: Partial<Record<ColorTokenName, readonly ColorTokenName[]>> = {
  ink: ['bg', 'surface', 'surface-raised', 'surface-muted'],
  'ink-muted': ['bg', 'surface', 'surface-raised'],
  primary: ['bg', 'surface', 'primary-soft'],
  'on-primary': ['primary', 'primary-hover'],
  'accent-ink': ['surface', 'accent-soft'],
  'on-accent': ['accent', 'accent-hover'],
  error: ['surface', 'error-soft'],
  warning: ['surface', 'warning-soft'],
  info: ['surface', 'info-soft'],
  success: ['surface', 'success-soft'],
  'on-destructive': ['destructive', 'destructive-hover'],
  destructive: ['surface'],
  'figure-positive': ['surface', 'bg'],
  'figure-negative': ['surface', 'bg'],
  'status-on-time': ['status-on-time-surface'],
  'status-late': ['status-late-surface'],
  'status-done': ['status-done-surface'],
  'status-cancelled': ['status-cancelled-surface'],
  'status-neutral': ['status-neutral-surface'],
};

// DS-08: control borders, focus ring and meaningful icons, checked at 3:1.
export const uiPairs: Partial<Record<ColorTokenName, readonly ColorTokenName[]>> = {
  'line-strong': ['surface', 'bg'],
  primary: ['surface', 'bg', 'surface-raised'],
};

export const spacingUnit = 8;

export const radius = { control: 6, panel: 10, pill: 999 } as const;

export const shadowTokens = {
  menu: {
    light: '0 4px 16px rgba(15, 27, 43, 0.12)',
    dark: '0 8px 24px rgba(0, 0, 0, 0.48)',
  },
  dialog: {
    light: '0 12px 32px rgba(15, 27, 43, 0.18)',
    dark: '0 16px 40px rgba(0, 0, 0, 0.56)',
  },
} as const;

export const size = {
  touch: 44,
  button: 44,
  buttonSmall: 36,
  input: 48,
  tableRow: 44,
  topbar: 64,
  topbarCompact: 56,
  sidebar: 264,
  sidebarRail: 72,
  container: 1200,
  reading: 720,
} as const;

export const breakpoints = { xs: 0, sm: 600, md: 900, lg: 1200, xl: 1536 } as const;

export const fontFamily =
  'var(--font-inter), Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export interface TypeToken {
  size: number;
  lineHeight: number;
  weight: 400 | 500 | 600 | 700;
  letterSpacing: string;
}

// px values from DESIGN.md §5; the theme converts them to rem.
export const typeScale = {
  h1: { size: 32, lineHeight: 40, weight: 700, letterSpacing: '-0.02em' },
  h1Compact: { size: 28, lineHeight: 36, weight: 700, letterSpacing: '-0.02em' },
  h2: { size: 24, lineHeight: 32, weight: 700, letterSpacing: '-0.015em' },
  h3: { size: 20, lineHeight: 28, weight: 600, letterSpacing: '-0.01em' },
  h4: { size: 18, lineHeight: 26, weight: 600, letterSpacing: '0' },
  h5: { size: 16, lineHeight: 24, weight: 600, letterSpacing: '0' },
  h6: { size: 14, lineHeight: 20, weight: 600, letterSpacing: '0' },
  subtitle1: { size: 16, lineHeight: 24, weight: 500, letterSpacing: '0' },
  subtitle2: { size: 14, lineHeight: 20, weight: 500, letterSpacing: '0' },
  body1: { size: 16, lineHeight: 24, weight: 400, letterSpacing: '0' },
  body2: { size: 14, lineHeight: 20, weight: 400, letterSpacing: '0' },
  caption: { size: 12, lineHeight: 16, weight: 400, letterSpacing: '0.01em' },
  overline: { size: 12, lineHeight: 16, weight: 600, letterSpacing: '0.08em' },
  button: { size: 14, lineHeight: 20, weight: 600, letterSpacing: '0.01em' },
  metric: { size: 28, lineHeight: 36, weight: 600, letterSpacing: '-0.01em' },
} as const satisfies Record<string, TypeToken>;
