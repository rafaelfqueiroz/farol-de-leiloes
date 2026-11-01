// Module augmentation for the project tokens (DESIGN.md §2), so `sx`, `theme.palette.*` and
// `theme.vars.*` are type-checked. Not named `theme.d.ts`: TypeScript drops a `.d.ts` that sits
// next to a `.ts` of the same name.
import type { CSSProperties } from 'react';
import '@mui/material/styles';
import '@mui/material/Typography';
import '@mui/material/Button';
import '@mui/material/IconButton';

interface StatusPalette {
  onTime: string;
  onTimeSurface: string;
  late: string;
  lateSurface: string;
  done: string;
  doneSurface: string;
  cancelled: string;
  cancelledSurface: string;
  neutral: string;
  neutralSurface: string;
}

interface FigurePalette {
  positive: string;
  negative: string;
}

interface BorderPalette {
  control: string;
}

declare module '@mui/material/styles' {
  interface TypeBackground {
    raised: string;
    muted: string;
  }

  interface PaletteColor {
    /** Tinted background: selected state, alert and highlight bands. */
    soft?: string;
    /** `secondary` only: amber usable as text (DESIGN.md `accent-ink`). */
    ink?: string;
  }

  interface SimplePaletteColorOptions {
    soft?: string;
    ink?: string;
  }

  interface Palette {
    destructive: PaletteColor;
    figure: FigurePalette;
    status: StatusPalette;
    border: BorderPalette;
    focus: string;
    overlay: string;
  }

  interface PaletteOptions {
    destructive?: SimplePaletteColorOptions;
    figure?: FigurePalette;
    status?: StatusPalette;
    border?: BorderPalette;
    focus?: string;
    overlay?: string;
  }

  interface Shape {
    panelRadius: number;
    pillRadius: number;
  }

  interface ShapeOptions {
    panelRadius?: number;
    pillRadius?: number;
  }

  interface TypographyVariants {
    metric: CSSProperties;
    wordmark: CSSProperties;
  }

  interface TypographyVariantsOptions {
    metric?: CSSProperties;
    wordmark?: CSSProperties;
  }

  /** Layout sizes in px (DESIGN.md §2 Sizes, §6), exposed so components never import tokens.ts. */
  interface Layout {
    containerWidth: number;
    readingWidth: number;
    /** `size-sidebar`: the AppShell sidebar from lg, and pinned open from md. */
    sidebarWidth: number;
    /** `size-sidebar` rail: the AppShell icon rail from md to lg. */
    railWidth: number;
    /** `size-topbar`: the top bar from md. */
    topbarHeight: number;
    /** `size-topbar` below md. */
    topbarCompactHeight: number;
  }

  interface Theme {
    layout: Layout;
  }

  interface ThemeOptions {
    layout?: Layout;
  }
}

declare module '@mui/material/Typography' {
  interface TypographyPropsVariantOverrides {
    metric: true;
    wordmark: true;
  }
}

declare module '@mui/material/Button' {
  interface ButtonPropsColorOverrides {
    destructive: true;
  }
}

declare module '@mui/material/IconButton' {
  interface IconButtonPropsColorOverrides {
    destructive: true;
  }
}
