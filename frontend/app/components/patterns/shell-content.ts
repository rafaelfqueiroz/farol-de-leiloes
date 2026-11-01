import type { Theme } from '@mui/material/styles';

/**
 * The height of the AppShell content area — the viewport under the top bar (56px below md, 64px
 * from md, border included). Spinners and placeholders inside the shell fill this instead of
 * `100vh`, which overflowed by the bar's height and added a scrollbar (#42, DS-04).
 */
export function shellContentMinHeight(theme: Theme) {
  return {
    minHeight: `calc(100dvh - ${theme.layout.topbarCompactHeight}px)`,
    [theme.breakpoints.up('md')]: {
      minHeight: `calc(100dvh - ${theme.layout.topbarHeight}px)`,
    },
  };
}
