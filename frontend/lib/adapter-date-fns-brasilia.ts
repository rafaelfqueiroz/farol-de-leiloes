import { TZDate, tz } from '@date-fns/tz';
import { parse, parseISO } from 'date-fns';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import type { DateBuilderReturnType } from '@mui/x-date-pickers/models';
import { TIME_ZONE } from '@/i18n/config';

// AR-23, DS-26: MUI's date-fns adapter creates browser-local Dates. Supply TZDate at
// its construction/parsing boundaries; date-fns v4 preserves that zone during edits.
// This adapter intentionally serves only the product's Brasília zone.
export class AdapterDateFnsBrasilia extends AdapterDateFns {
  override date = <T extends string | null | undefined>(value?: T): DateBuilderReturnType<T> => {
    const date =
      value === null
        ? null
        : value === undefined
          ? new TZDate(Date.now(), TIME_ZONE)
          : parseISO(value, { in: tz(TIME_ZONE) });
    return date as DateBuilderReturnType<T>;
  };

  override parse = (value: string, format: string): Date | null =>
    value === ''
      ? null
      : parse(value, format, new TZDate(Date.now(), TIME_ZONE), {
          locale: this.locale,
          in: tz(TIME_ZONE),
        });

  override getTimezone = (): string => TIME_ZONE;

  override setTimezone = (value: Date): Date => new TZDate(value, TIME_ZONE);
}
