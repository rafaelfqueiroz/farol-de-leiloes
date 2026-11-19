'use client';

import type { SvgIconComponent } from '@mui/icons-material';
import RouteOutlined from '@mui/icons-material/RouteOutlined';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import { visuallyHidden } from '@mui/utils';
import { useTranslations } from 'next-intl';
import { useId, type ReactNode } from 'react';
import Money from '@/app/components/patterns/Money';
import StatusBadge from '@/app/components/patterns/StatusBadge';

export interface PlanCardHint {
  /** An Outlined icon (DS-25): an arrow for a change, an info mark for the current plan. */
  icon: SvgIconComponent;
  text: ReactNode;
}

export interface PlanCardProps {
  name: string;
  /** AR-17: a decimal string of reais, rendered by `Money`. */
  price: string;
  interval: 'month' | 'year';
  activeJourneyLimit: number;
  /** The plan of the visitor's office: a 2 px primary border and the "Plano atual" pill (DS-10). */
  current?: boolean;
  /** What choosing it does, in one line, with its icon. */
  hint?: PlanCardHint;
  /**
   * The call to action. It receives the id of the plan's heading so the button can name the plan
   * through `aria-describedby`: the visible label stays the accessible name (DS-21).
   */
  action: (headingId: string) => ReactNode;
}

/**
 * DS-17 (SPEC-012 frame set 1, feature `plans`, DS-02): one plan of the catalogue: name, price per
 * interval, the active-journey limit and one action. Built from system parts only (`Card`,
 * `Money`, `StatusBadge`). The card is an `article` named by its heading; there is no
 * "most popular" highlight and no amber (DS-24): the only emphasis is the current plan.
 */
export default function PlanCard({
  name,
  price,
  interval,
  activeJourneyLimit,
  current = false,
  hint,
  action,
}: PlanCardProps) {
  const t = useTranslations('plans.card');
  const headingId = useId();
  const HintIcon = hint?.icon;

  return (
    <Card
      component="article"
      aria-labelledby={headingId}
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        p: { xs: 2, sm: 3 },
        // the border is 2 px either way, so marking the current plan moves nothing
        borderWidth: 2,
        borderColor: current ? 'primary.main' : 'divider',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Typography id={headingId} variant="h4" component="h2">
          {name}
        </Typography>
        {current ? <StatusBadge status="done" label={t('current')} /> : null}
      </Box>
      <Typography component="p" variant="body2" sx={{ color: 'text.secondary' }}>
        <Typography component="span" variant="metric" sx={{ color: 'text.primary' }}>
          <Money value={price} />
        </Typography>{' '}
        <span aria-hidden>{t('perInterval', { interval })}</span>
        <Box component="span" sx={visuallyHidden}>
          {t('perIntervalSr', { interval })}
        </Box>
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <RouteOutlined aria-hidden fontSize="small" sx={{ color: 'text.secondary' }} />
        <Typography variant="body2">
          {t.rich('limit', {
            count: activeJourneyLimit,
            // DS-12: the figure is the emphasised part of the sentence and lines up
            strong: (chunks) => (
              <Box component="strong" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                {chunks}
              </Box>
            ),
          })}
        </Typography>
      </Box>
      <Box sx={{ mt: 'auto', display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {hint && HintIcon ? (
          <Typography
            variant="caption"
            component="p"
            sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', color: 'text.secondary' }}
          >
            <HintIcon aria-hidden fontSize="inherit" sx={{ mt: 0.25 }} />
            <span>{hint.text}</span>
          </Typography>
        ) : null}
        {action(headingId)}
      </Box>
    </Card>
  );
}
