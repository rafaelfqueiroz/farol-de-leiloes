'use client';

import LinearProgress from '@mui/material/LinearProgress';

export interface ProgressBarProps {
  /** How much is used: 4 of 5. */
  value: number;
  /** The most it can be; above zero. */
  max: number;
  /** What the bar measures, from the catalogue: "Jornadas em andamento" (DS-20, DS-21). */
  label: string;
  /** The same fact in words ("4 de 5 jornadas em andamento"), for assistive technology. */
  valueText?: string;
  /** `warning` when the limit is reached; the text next to the bar says it too (DS-10). */
  tone?: 'primary' | 'warning';
}

/**
 * DS-17: a determinate linear progress that is a real `progressbar` with a name and its own value
 * range (`0..max`, not a percentage), so a screen reader hears "4 of 5" and not "80 %". The bar is
 * never the only signal (DS-10): the caller shows the figure and a full bar in `warning` is
 * accompanied by its message.
 */
export default function ProgressBar({
  value,
  max,
  label,
  valueText,
  tone = 'primary',
}: ProgressBarProps) {
  const clamped = Math.min(Math.max(value, 0), max);
  return (
    <LinearProgress
      variant="determinate"
      value={(clamped / max) * 100}
      color={tone}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={clamped}
      aria-valuetext={valueText}
    />
  );
}
