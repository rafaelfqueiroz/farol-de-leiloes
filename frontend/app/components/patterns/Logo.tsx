'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslations } from 'next-intl';

export interface LogoProps {
  /** `lockup` = mark + wordmark; `mark` = the lighthouse alone (phone top bar). */
  variant: 'lockup' | 'mark';
  /** Mark edge in px. Minimum 24; below that use the app icon. Default 32. */
  size?: number;
}

// Geometry of public/brand/farol-mark.svg. Fills are bound to palette variables instead of the
// file's hex values, so the scheme switch recolours the mark with no re-render (DS-04).
function Mark({ size, label }: { size: number; label: string }) {
  return (
    <Box
      component="svg"
      viewBox="0 0 48 48"
      role="img"
      aria-label={label}
      focusable="false"
      sx={(theme) => {
        // theme.vars holds the var(--mui-palette-…) references, so the fill follows the scheme
        const { palette } = theme.vars ?? theme;
        return {
          width: size,
          height: size,
          flexShrink: 0,
          '& .beam': { fill: palette.secondary.main },
          '& .tower': { fill: palette.primary.main },
          // the band is cut out of the tower: it shows the ground behind it
          '& .band': { fill: palette.background.paper },
        };
      }}
    >
      <polygon className="beam" points="20,12.5 3,7.5 3,20.5 20,16.5" />
      <polygon className="beam" points="28,12.5 45,7.5 45,20.5 28,16.5" />
      <polygon className="tower" points="18.5,11 24,5 29.5,11" />
      <rect className="beam" x="20" y="11" width="8" height="6" />
      <rect className="tower" x="18" y="17" width="12" height="2" />
      <polygon className="tower" points="19.5,19 28.5,19 31,43 17,43" />
      <polygon className="band" points="18.67,27 29.33,27 29.75,31 18.25,31" />
      <rect className="tower" x="13" y="43" width="22" height="2.5" rx="1.25" />
    </Box>
  );
}

export default function Logo({ variant, size = 32 }: LogoProps) {
  const t = useTranslations('patterns.logo');
  const name = t('name');

  if (variant === 'mark') return <Mark size={size} label={name} />;

  // The brand name is a proper noun: "Farol" + "dos Leilões", split at the first space
  const split = name.indexOf(' ');
  const first = split < 0 ? name : name.slice(0, split);
  const rest = split < 0 ? '' : name.slice(split + 1);

  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
      <Mark size={size} label={name} />
      {/* the mark already announces the name: hide the live text from assistive tech */}
      <Typography
        component="span"
        variant="h3"
        aria-hidden
        sx={(theme) => ({ letterSpacing: '-0.015em', whiteSpace: 'nowrap', fontWeight: theme.typography.fontWeightBold })}
      >
        {first}{' '}
        <Box
          component="span"
          sx={(theme) => ({ color: 'text.secondary', fontWeight: theme.typography.fontWeightMedium })}
        >
          {rest}
        </Box>
      </Typography>
    </Box>
  );
}
