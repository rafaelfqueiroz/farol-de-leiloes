'use client';

import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import InlineAlert from '@/app/components/patterns/InlineAlert';

export interface JourneyLimitAlertProps {
  /** The office's journeys in progress: `context.inProgress` of `JOURNEY_LIMIT_REACHED`. */
  inProgress: number;
  /** The limit of the plan in effect: `context.limit`. */
  limit: number;
  /** The way forward that is a click, usually "Mudar de plano" (SPEC-016 links it to /office/plan). */
  action?: ReactNode;
}

/**
 * SPEC-012 BR-012-25, BR-012-26 (frame o4): "Limite de jornadas atingido: 2 de 2. Encerre uma
 * jornada ou mude de plano." The count and the limit are the figures of `JOURNEY_LIMIT_REACHED`'s
 * context, and the sentence names both ways forward. The office plan page shows it when the bar is
 * full; SPEC-016 shows the same alert when a start is refused.
 */
export default function JourneyLimitAlert({ inProgress, limit, action }: JourneyLimitAlertProps) {
  const t = useTranslations('officePlan.limitReached');
  return (
    <InlineAlert severity="warning" action={action}>
      {t('text', { inProgress, limit })}
    </InlineAlert>
  );
}
