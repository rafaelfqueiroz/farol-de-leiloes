'use client';

import { useState } from 'react';
import { DatePicker } from '@mui/x-date-pickers/DatePicker';
import { DateTimePicker } from '@mui/x-date-pickers/DateTimePicker';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { ptBR as ptBRPickers } from '@mui/x-date-pickers/locales';
import { isValid } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  calendarToWallClock,
  instantToWallClock,
  wallClockToCalendar,
  wallClockToInstant,
} from '@/lib/dates';

// DS-26: @mui/x-date-pickers on the date-fns adapter, ptBR locale, Brasília zone (AR-23).
const LOCALE_TEXT = ptBRPickers.components.MuiLocalizationProvider.defaultProps.localeText;

export interface DateFieldProps {
  label: string;
  /**
   * `date`: a `YYYY-MM-DD` calendar date, never shifted by a zone (AR-22).
   * `datetime`: an ISO instant, shown and edited in Brasília time (AR-23).
   */
  type?: 'date' | 'datetime';
  /** The value in the form `type` names, or null. */
  value: string | null;
  /** The new value in the same form, or null while the field is empty or only partly typed. */
  onChange: (value: string | null) => void;
  helperText?: string;
  /** The earliest choice, in the same form as `value`. */
  min?: string;
  /** Minutes between choices in the clock list; `datetime` only. */
  minuteStep?: number;
  error?: boolean;
  required?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
}

function toPicker(value: string | null, type: 'date' | 'datetime'): Date | null {
  if (value === null) return null;
  try {
    return type === 'datetime' ? instantToWallClock(value) : calendarToWallClock(value);
  } catch (error: unknown) {
    // AR-22: malformed API dates stay empty and editable rather than breaking the form.
    if (error instanceof RangeError) return null;
    throw error;
  }
}

function fromPicker(picked: Date | null, type: 'date' | 'datetime'): string | null {
  if (picked === null || !isValid(picked)) return null;
  return type === 'datetime' ? wallClockToInstant(picked) : wallClockToCalendar(picked);
}

// DS-26, BR-003-20: typed dd/mm/aaaa, keyboard operable (BR-003-16), calendar as a convenience.
export default function DateField({
  label,
  type = 'date',
  value,
  onChange,
  helperText,
  min,
  minuteStep = 1,
  error,
  required,
  disabled,
  fullWidth = true,
}: DateFieldProps) {
  // The picker keeps the half-typed text of an invalid date; the parent only ever sees a valid
  // value or null. `synced` tells a value the parent echoes back (keep the draft) from one it
  // set itself (replace the draft).
  const [draft, setDraft] = useState<Date | null>(() => toPicker(value, type));
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(toPicker(value, type));
  }

  const handleChange = (picked: Date | null) => {
    const next = fromPicker(picked, type);
    setDraft(picked);
    setSynced(next);
    onChange(next);
  };

  const slotProps = {
    textField: { fullWidth, helperText, error, required, disabled },
  };

  return (
    <LocalizationProvider
      dateAdapter={AdapterDateFns}
      adapterLocale={ptBR}
      localeText={LOCALE_TEXT}
    >
      {type === 'datetime' ? (
        <DateTimePicker
          label={label}
          value={draft}
          onChange={handleChange}
          ampm={false}
          format="dd/MM/yyyy HH:mm"
          timeSteps={{ minutes: minuteStep }}
          minDateTime={min ? (toPicker(min, 'datetime') ?? undefined) : undefined}
          disabled={disabled}
          slotProps={slotProps}
        />
      ) : (
        <DatePicker
          label={label}
          value={draft}
          onChange={handleChange}
          format="dd/MM/yyyy"
          minDate={min ? (toPicker(min, 'date') ?? undefined) : undefined}
          disabled={disabled}
          slotProps={slotProps}
        />
      )}
    </LocalizationProvider>
  );
}
