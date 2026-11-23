'use client';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

export interface KeyFact {
  /** Stable key and, with `label`, the pair's identity. */
  id: string;
  /** What the fact is, from the catalogue: "Próxima cobrança". */
  label: string;
  /** The value: text, or `Money` / `DateText` (DS-29). */
  value: ReactNode;
}

export interface KeyFactsGridProps {
  facts: readonly KeyFact[];
}

/**
 * DS-17 (promoted from the auctions feature, SPEC-012 frame set 3): label/value facts about one
 * record in a responsive `<dl>`. As many columns as fit (192 px each, so one on a 360 px phone),
 * the label above the value (caption over a 600-weight body line). Domain-free (DS-03): the value is
 * whatever the caller renders.
 */
export default function KeyFactsGrid({ facts }: KeyFactsGridProps) {
  return (
    <Box
      component="dl"
      sx={(theme) => ({
        display: 'grid',
        gridTemplateColumns: `repeat(auto-fit, minmax(${theme.spacing(24)}, 1fr))`,
        gap: theme.spacing(2, 3),
        m: 0,
      })}
    >
      {facts.map((fact) => (
        <Box key={fact.id} sx={{ minWidth: 0 }}>
          <Typography component="dt" variant="caption" sx={{ color: 'text.secondary' }}>
            {fact.label}
          </Typography>
          <Typography
            component="dd"
            variant="subtitle1"
            sx={{ m: 0, fontWeight: 600, overflowWrap: 'anywhere' }}
          >
            {fact.value}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}
