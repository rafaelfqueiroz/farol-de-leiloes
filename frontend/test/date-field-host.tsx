import { useState } from 'react';
import DateField, { type DateFieldProps } from '@/app/components/DateField';

// A controlled host, like the dialogs that use the field.
export function DateFieldHost({
  initial = null,
  onValue,
  ...props
}: Partial<Omit<DateFieldProps, 'value' | 'onChange'>> & {
  initial?: string | null;
  onValue?: (value: string | null) => void;
}) {
  const [value, setValue] = useState<string | null>(initial);
  return (
    <DateField
      label="Data e hora"
      {...props}
      value={value}
      onChange={(next) => {
        setValue(next);
        onValue?.(next);
      }}
    />
  );
}
