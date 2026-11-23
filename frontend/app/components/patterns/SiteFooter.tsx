'use client';

import Box from '@mui/material/Box';
import MuiLink from '@mui/material/Link';
import Typography from '@mui/material/Typography';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LEGAL_PATHS } from '@/lib/legal';

export interface SiteFooterProps {
  /** The year in the notice; defaults to the current one. Injectable so tests do not depend on today. */
  year?: number;
}

// SPEC-010 BR-010-02 (frame "SiteFooter"): the terms and the privacy policy open from the end of
// every page, signed in or not. It sits at the end of the content, never fixed, in the page
// surface with a divider above (cards are flat, DS-09). Links are 44 px targets (DS-16).
export default function SiteFooter({ year }: SiteFooterProps) {
  const t = useTranslations('patterns.siteFooter');
  const links = [
    { href: LEGAL_PATHS.terms, label: t('terms') },
    { href: LEGAL_PATHS.privacy, label: t('privacy') },
    { href: '/support', label: t('support') },
  ];

  return (
    <Box
      component="footer"
      sx={{
        bgcolor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
        px: { xs: 2, sm: 3 },
        py: { xs: 2, sm: 1 },
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'flex-start', sm: 'center' },
        justifyContent: 'space-between',
        gap: { xs: 1, sm: 2 },
      }}
    >
      <Box component="nav" aria-label={t('navigation')}>
        <Box
          component="ul"
          sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, m: 0, p: 0, listStyle: 'none' }}
        >
          {links.map(({ href, label }) => (
            <li key={href}>
              <MuiLink
                component={Link}
                href={href}
                variant="subtitle2"
                underline="always"
                sx={(theme) => ({
                  display: 'inline-flex',
                  alignItems: 'center',
                  minHeight: theme.spacing(5.5),
                  textUnderlineOffset: theme.spacing(0.375),
                })}
              >
                {label}
              </MuiLink>
            </li>
          ))}
        </Box>
      </Box>
      <Typography variant="caption" sx={{ color: 'text.secondary' }} suppressHydrationWarning>
        {t('copyright', { year: year ?? new Date().getUTCFullYear() })}
      </Typography>
    </Box>
  );
}
