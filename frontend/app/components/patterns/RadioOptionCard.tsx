'use client';

import Box from '@mui/material/Box';
import Radio from '@mui/material/Radio';
import { useRadioGroup } from '@mui/material/RadioGroup';
import Typography from '@mui/material/Typography';
import { useId, type ReactNode } from 'react';

export interface RadioOptionCardProps {
  /** The option's value inside the surrounding `RadioGroup`. */
  value: string;
  /** What the option is called: the radio's accessible name. */
  title: string;
  /** The figure at the end of the title line (a price); rendered by the caller (DS-29). */
  trailing?: ReactNode;
  /** One line under the title. */
  description?: ReactNode;
  /** What choosing it does; shown only while selected, and read as the radio's description. */
  effect?: ReactNode;
  /** A state label under the description ("Plano atual"), read with the description. */
  badge?: ReactNode;
  /** Not choosable (the plan already in effect). */
  disabled?: boolean;
}

/**
 * DS-17 (SPEC-012 frame 13): one option of a `RadioGroup` as a card, the whole card the target
 * (DS-16). Selected: a 2 px primary border on `primary.soft` (never colour alone: the radio is
 * filled too, DS-10); disabled: the quiet `background.muted` fill. The group supplies the
 * `fieldset` and its legend, the cards supply the choices.
 */
export default function RadioOptionCard({
  value,
  title,
  trailing,
  description,
  effect,
  badge,
  disabled = false,
}: RadioOptionCardProps) {
  const group = useRadioGroup();
  const selected = group?.value === value;
  const id = useId();
  const titleId = `${id}-title`;
  const detailId = `${id}-detail`;

  return (
    <Box
      component="label"
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1,
        py: 1.5,
        pr: 2,
        pl: 1,
        minHeight: theme.spacing(5.5),
        boxSizing: 'border-box',
        // a border on every state, so selecting never shifts the layout
        border: 2,
        borderStyle: 'solid',
        borderColor: selected ? 'primary.main' : 'divider',
        borderRadius: `${theme.shape.panelRadius}px`,
        bgcolor: selected ? 'primary.soft' : disabled ? 'background.muted' : 'background.paper',
        cursor: disabled ? 'default' : 'pointer',
        // DS-21: the 2 px focus ring on the whole card
        '&:focus-within': {
          outline: 2,
          outlineStyle: 'solid',
          outlineColor: theme.vars?.palette.focus,
          outlineOffset: 2,
        },
      })}
    >
      <Radio
        value={value}
        disabled={disabled}
        // the label wraps everything, so the name is the title alone and the rest is the description
        slotProps={{
          input: {
            'aria-labelledby': titleId,
            'aria-describedby': detailId,
          },
        }}
        sx={{ mt: -0.5, '&.Mui-focusVisible': { outline: 'none' } }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, flexWrap: 'wrap' }}>
          <Typography id={titleId} variant="subtitle1" component="span">
            {title}
          </Typography>
          {trailing ? (
            <Typography variant="subtitle2" component="span">
              {trailing}
            </Typography>
          ) : null}
        </Box>
        <Box id={detailId}>
          {description ? (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {description}
            </Typography>
          ) : null}
          {badge ? <Box sx={{ mt: 0.5 }}>{badge}</Box> : null}
          {selected && effect ? (
            <Typography variant="caption" component="div" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {effect}
            </Typography>
          ) : null}
        </Box>
      </Box>
    </Box>
  );
}
