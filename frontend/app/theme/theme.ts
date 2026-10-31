import { alpha, createTheme, type PaletteOptions, type Shadows } from '@mui/material/styles';
import type { TypographyVariantsOptions } from '@mui/material/styles';
import {
  breakpoints,
  colorToken,
  fontFamily,
  radius,
  shadowTokens,
  size,
  spacingUnit,
  typeScale,
  type SchemeName,
  type TypeToken,
} from './tokens';

function palette(scheme: SchemeName): PaletteOptions {
  const c = (name: Parameters<typeof colorToken>[0]) => colorToken(name, scheme);
  return {
    primary: {
      main: c('primary'),
      dark: c('primary-hover'),
      soft: c('primary-soft'),
      contrastText: c('on-primary'),
    },
    // DS-24: amber is the logo and rare highlights, never an action
    secondary: {
      main: c('accent'),
      dark: c('accent-hover'),
      soft: c('accent-soft'),
      ink: c('accent-ink'),
      contrastText: c('on-accent'),
    },
    error: { main: c('error'), soft: c('error-soft') },
    warning: { main: c('warning'), soft: c('warning-soft') },
    info: { main: c('info'), soft: c('info-soft') },
    success: { main: c('success'), soft: c('success-soft') },
    // DS-06: a full palette colour so `<Button color="destructive">` works
    destructive: {
      main: c('destructive'),
      dark: c('destructive-hover'),
      contrastText: c('on-destructive'),
    },
    figure: { positive: c('figure-positive'), negative: c('figure-negative') },
    status: {
      onTime: c('status-on-time'),
      onTimeSurface: c('status-on-time-surface'),
      late: c('status-late'),
      lateSurface: c('status-late-surface'),
      done: c('status-done'),
      doneSurface: c('status-done-surface'),
      cancelled: c('status-cancelled'),
      cancelledSurface: c('status-cancelled-surface'),
      neutral: c('status-neutral'),
      neutralSurface: c('status-neutral-surface'),
    },
    background: {
      default: c('bg'),
      paper: c('surface'),
      raised: c('surface-raised'),
      muted: c('surface-muted'),
    },
    text: { primary: c('ink'), secondary: c('ink-muted'), disabled: c('ink-disabled') },
    divider: c('line'),
    border: { control: c('line-strong') },
    focus: c('focus'),
    overlay: c('overlay'),
    action: {
      hover: alpha(c('ink'), scheme === 'light' ? 0.06 : 0.08),
      selected: c('primary-soft'),
    },
  };
}

const rem = (px: number) => `${px / 16}rem`;

function variant({ size: fontSize, lineHeight, weight, letterSpacing }: TypeToken) {
  return {
    fontFamily,
    fontSize: rem(fontSize),
    lineHeight: `${lineHeight / fontSize}`,
    fontWeight: weight,
    letterSpacing,
  };
}

const mdUp = `@media (min-width:${breakpoints.md}px)`;

// DS-01, DS-11: sizes and weights only — no colours in typography.
const typography: TypographyVariantsOptions = {
  fontFamily,
  htmlFontSize: 16,
  fontWeightRegular: 400,
  fontWeightMedium: 500,
  fontWeightBold: 700,
  // 28/36 below md, 32/40 from md (DESIGN.md §5)
  h1: { ...variant(typeScale.h1Compact), [mdUp]: variant(typeScale.h1) },
  h2: variant(typeScale.h2),
  h3: variant(typeScale.h3),
  h4: variant(typeScale.h4),
  h5: variant(typeScale.h5),
  h6: variant(typeScale.h6),
  subtitle1: variant(typeScale.subtitle1),
  subtitle2: variant(typeScale.subtitle2),
  body1: variant(typeScale.body1),
  body2: variant(typeScale.body2),
  caption: variant(typeScale.caption),
  overline: { ...variant(typeScale.overline), textTransform: 'uppercase' },
  button: { ...variant(typeScale.button), textTransform: 'none' },
  // DS-12: headline figures line up
  metric: { ...variant(typeScale.metric), fontVariantNumeric: 'tabular-nums' },
};

// Shadows are scheme-dependent (DESIGN.md §2), so the MUI shadow scale points at custom
// properties that CssBaseline defines per scheme. Cards stay flat: elevations below 4 are none.
const shadowMenu = 'var(--farol-shadow-menu)';
const shadowDialog = 'var(--farol-shadow-dialog)';
const shadows = Array.from({ length: 25 }, (_, elevation) => {
  if (elevation < 4) return 'none';
  return elevation < 8 ? shadowMenu : shadowDialog;
}) as Shadows;

// DS-16: below md every control is a touch target; small (36px) only from md up
const smallFromMd = { minHeight: size.touch, [mdUp]: { minHeight: size.buttonSmall } };

export const theme = createTheme({
  // DS-04, DS-07: CSS variables, light/dark/system switched by a class on <html>
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: { palette: palette('light') },
    dark: { palette: palette('dark') },
  },
  breakpoints: { values: breakpoints },
  spacing: spacingUnit,
  shape: { borderRadius: radius.control, panelRadius: radius.panel, pillRadius: radius.pill },
  typography,
  shadows,
  // DS-18: product-wide restyling happens here, once
  components: {
    MuiCssBaseline: {
      styleOverrides: (theme) => ({
        ':root': {
          '--farol-shadow-menu': shadowTokens.menu.light,
          '--farol-shadow-dialog': shadowTokens.dialog.light,
        },
        // matches `colorSchemeSelector: 'class'`
        '.dark': {
          '--farol-shadow-menu': shadowTokens.menu.dark,
          '--farol-shadow-dialog': shadowTokens.dialog.dark,
        },
        // DS-12: columns of values line up
        'table, time': { fontVariantNumeric: 'tabular-nums' },
        // DS-21: focus is always visible
        'a:focus-visible': {
          outline: `2px solid ${theme.vars.palette.focus}`,
          outlineOffset: 2,
        },
        // DS-21: motion respects prefers-reduced-motion
        '@media (prefers-reduced-motion: reduce)': {
          '*, *::before, *::after': {
            animationDuration: '0.01ms !important',
            animationIterationCount: '1 !important',
            transitionDuration: '0.01ms !important',
            scrollBehavior: 'auto !important',
          },
        },
      }),
    },
    MuiButtonBase: {
      styleOverrides: {
        root: ({ theme }) => ({
          // DS-21: 2px solid focus ring with a 2px offset
          '&.Mui-focusVisible': {
            outline: `2px solid ${theme.vars.palette.focus}`,
            outlineOffset: 2,
          },
        }),
      },
    },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: size.button },
        sizeSmall: smallFromMd,
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: { minWidth: size.touch, minHeight: size.touch },
        sizeSmall: {
          minWidth: size.touch,
          [mdUp]: { minWidth: size.buttonSmall, minHeight: size.buttonSmall },
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: { root: { minHeight: size.touch } },
    },
    MuiMenuItem: {
      styleOverrides: { root: { minHeight: size.touch } },
    },
    MuiPaper: {
      // the dark-mode elevation overlay would wash out the layered surfaces (DS-09)
      styleOverrides: { root: { backgroundImage: 'none' } },
    },
    MuiCard: {
      // cards are flat: a line border, no shadow
      defaultProps: { variant: 'outlined' },
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: theme.shape.panelRadius,
          borderColor: theme.vars.palette.divider,
        }),
      },
    },
    MuiPopover: {
      styleOverrides: {
        paper: ({ theme }) => ({
          backgroundColor: theme.vars.palette.background.raised,
          boxShadow: theme.vars.shadows[4],
        }),
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: ({ theme }) => ({
          backgroundColor: theme.vars.palette.background.raised,
          borderRadius: theme.shape.panelRadius,
          boxShadow: theme.vars.shadows[8],
        }),
      },
    },
    MuiBackdrop: {
      styleOverrides: {
        root: ({ theme }) => ({
          '&:not(.MuiBackdrop-invisible)': { backgroundColor: theme.vars.palette.overlay },
        }),
      },
    },
    MuiTextField: {
      // labels sit above the field, so an empty field never hides its label
      defaultProps: { slotProps: { inputLabel: { shrink: true } } },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: { minHeight: size.input },
        input: { padding: '12px 14px', height: rem(24) },
        multiline: { padding: '12px 14px' },
        inputMultiline: { padding: 0 },
        sizeSmall: { minHeight: size.touch },
        inputSizeSmall: { padding: '10px 14px' },
        // DS-08: resting border at 3:1 on surface
        notchedOutline: ({ theme }) => ({ borderColor: theme.vars.palette.border.control }),
      },
    },
    MuiChip: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: theme.shape.pillRadius,
          variants: [
            {
              props: { variant: 'filled', color: 'default' },
              style: { backgroundColor: theme.vars.palette.background.muted },
            },
          ],
        }),
      },
    },
    MuiTooltip: {
      styleOverrides: {
        tooltip: ({ theme }) => ({
          ...theme.typography.caption,
          backgroundColor: theme.vars.palette.text.primary,
          color: theme.vars.palette.background.paper,
          borderRadius: theme.shape.borderRadius,
        }),
        arrow: ({ theme }) => ({ color: theme.vars.palette.text.primary }),
      },
    },
  },
});
