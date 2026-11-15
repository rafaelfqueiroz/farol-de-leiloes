'use client';

import type { SvgIconComponent } from '@mui/icons-material';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CircularProgress from '@mui/material/CircularProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@mui/utils';
import type { ReactNode } from 'react';
import Logo from './Logo';
import PageHeader from './PageHeader';
import PageShell from './PageShell';

// DS-14, DS-17 (frames 7 and 8): the three layouts of the pages outside the AppShell. Each is
// a `narrow` PageShell that carries its own <main> (DS-21), centred in the viewport, on the
// page background the body already paints (background.default).

function Centered({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center' }}>
      <PageShell width="narrow" component="main">
        {children}
      </PageShell>
    </Box>
  );
}

export interface AuthFormPageProps {
  /** The page's only <h1>. */
  title: string;
  /** What the old subtitle said. */
  summary?: ReactNode;
  children: ReactNode;
}

/** Frame 7: logo lockup, then a card with the PageHeader and the form. */
export function AuthFormPage({ title, summary, children }: AuthFormPageProps) {
  return (
    <Centered>
      <Box sx={{ display: 'flex', justifyContent: 'center' }}>
        {/* the card is background.paper, so the mark's primary tower reads on it */}
        <Logo variant="lockup" size={40} />
      </Box>
      <Card>
        <CardContent sx={{ p: { xs: 2, sm: 4 } }}>
          <Stack spacing={3}>
            <PageHeader title={title} summary={summary} />
            {children}
          </Stack>
        </CardContent>
      </Card>
    </Centered>
  );
}

export interface ResultScreenProps {
  /** The meaning of the screen, which colours the icon disc (DS-10, DS-24). */
  tone?: 'success' | 'info' | 'error';
  /** An Outlined icon from @mui/icons-material (DS-25). */
  icon?: SvgIconComponent;
  /** Shows a spinner in place of the icon disc while the result is not known yet. */
  loading?: boolean;
  /** The page's only <h1> in this state. */
  title: string;
  description?: ReactNode;
  /** Alerts and the next step (DS-19). */
  children?: ReactNode;
}

/** Frame 8: a centred card with the icon disc, the h1, a text and the action. */
export function ResultScreen({
  tone = 'info',
  icon: Icon,
  loading = false,
  title,
  description,
  children,
}: ResultScreenProps) {
  return (
    <Centered>
      <Card>
        <CardContent sx={{ px: { xs: 2, sm: 4 }, py: { xs: 4, sm: 6 } }}>
          <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center' }}>
            {loading ? (
              <CircularProgress aria-hidden />
            ) : Icon ? (
              <Box
                sx={(theme) => ({
                  width: theme.spacing(7),
                  height: theme.spacing(7),
                  borderRadius: '50%',
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: `${tone}.soft`,
                  color: `${tone}.main`,
                })}
              >
                <Icon aria-hidden fontSize="medium" />
              </Box>
            ) : null}
            <Typography variant="h1" component="h1" sx={{ textWrap: 'balance' }}>
              {title}
            </Typography>
            {description ? (
              <Typography variant="body1" sx={{ color: 'text.secondary' }}>
                {description}
              </Typography>
            ) : null}
            {children ? (
              <Stack spacing={2} sx={{ width: '100%' }}>
                {children}
              </Stack>
            ) : null}
          </Stack>
        </CardContent>
      </Card>
    </Centered>
  );
}

export interface LoadingScreenProps {
  /** The h1, visually hidden: the spinner is the whole visible content. */
  title: string;
}

/** Frame 8: a redirect spinner whose h1 is only for screen readers. */
export function LoadingScreen({ title }: LoadingScreenProps) {
  return (
    <Centered>
      <Stack sx={{ alignItems: 'center' }}>
        <Box component="h1" sx={visuallyHidden}>
          {title}
        </Box>
        <CircularProgress aria-hidden />
      </Stack>
    </Centered>
  );
}
