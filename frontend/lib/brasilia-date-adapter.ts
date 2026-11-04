import { TZDate, tz } from '@date-fns/tz';
import { AdapterDateFns } from '@mui/x-date-pickers/AdapterDateFns';
import type { DateBuilderReturnType } from '@mui/x-date-pickers/models';
import { parse, parseISO } from 'date-fns';
import { TIME_ZONE } from '@/i18n/config';

// AR-23, DS-26: the stock adapter ignores `timezone` and constructs browser-local Dates.
// Date-fns v4 preserves TZDate through its arithmetic, so pin every construction entry point
// to Brasília too, including empty-field references and pasted text (#86).
// This private adapter accepts ISO construction strings (including a space delimiter), not
// native Date's browser-dependent RFC/legacy formats. MUI's timezone argument is intentionally
// ignored, as in AdapterDateFns: this adapter always uses TIME_ZONE (AR-23, DS-26).
export class BrasiliaDateAdapter extends AdapterDateFns {
  override date = <T extends string | null | undefined>(value?: T): DateBuilderReturnType<T> => {
    const result =
      value === null
        ? null
        : value === undefined
          ? TZDate.tz(TIME_ZONE)
          : parseISO(value, { in: tz(TIME_ZONE) });
    // MUI's generic return type maps null input to null; TypeScript cannot narrow T itself.
    return result as DateBuilderReturnType<T>;
  };

  override parse = (value: string, format: string): Date | null => {
    if (value === '') return null;
    return parse(value, format, TZDate.tz(TIME_ZONE), { locale: this.locale });
  };

  override getInvalidDate = (): Date => new TZDate(Number.NaN, TIME_ZONE);
}
