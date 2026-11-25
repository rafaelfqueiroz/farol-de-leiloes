import { Inject, Injectable, Logger } from '@nestjs/common';
import { Clock } from '../clock/clock.js';
import { brasiliaToday } from '../clock/brasilia-time.js';
import {
  hasHolidaysInYear,
  isBusinessDay,
  nonBusinessReason,
  yearOf,
} from '../domain/business-day.js';
import businessConfig, { type BusinessConfig } from '../../config/business.config.js';

/**
 * SPEC-004 BR-004-31: the business-day question over the configured national-holiday calendar
 * (NATIONAL_HOLIDAYS, AR-43). The calendar is configuration an operator edits without a release
 * and it is never fetched from outside at run time. The rule itself is the pure `isBusinessDay`
 * (common/domain/business-day.ts).
 *
 * A year with no entries means the calendar was not set up for it: that is warned about once per
 * process per year, and only weekends count as non-business days (BR-004-31).
 */
@Injectable()
export class BusinessCalendar {
  private readonly logger = new Logger(BusinessCalendar.name);
  private readonly holidays: ReadonlySet<string>;
  private readonly warnedYears = new Set<number>();

  constructor(
    @Inject(businessConfig.KEY) config: BusinessConfig,
    private readonly clock: Clock, // AR-24
  ) {
    this.holidays = new Set(config.calendar.nationalHolidays);
  }

  /** `brasiliaDate` is a Brasília calendar day, `YYYY-MM-DD` (AR-22). */
  isBusinessDay(brasiliaDate: string): boolean {
    this.warnWhenYearIsNotConfigured(yearOf(brasiliaDate));
    return isBusinessDay(brasiliaDate, this.holidays);
  }

  /** Why `brasiliaDate` is not a business day, or null when it is one. */
  nonBusinessReason(brasiliaDate: string): 'WEEKEND' | 'HOLIDAY' | null {
    this.warnWhenYearIsNotConfigured(yearOf(brasiliaDate));
    return nonBusinessReason(brasiliaDate, this.holidays);
  }

  /** Whether today, in Brasília, is a business day. */
  isBusinessDayToday(): boolean {
    return this.isBusinessDay(brasiliaToday(this.clock));
  }

  private warnWhenYearIsNotConfigured(year: number): void {
    if (hasHolidaysInYear(year, this.holidays) || this.warnedYears.has(year)) return;
    this.warnedYears.add(year);
    this.logger.warn(
      `NATIONAL_HOLIDAYS has no entries for ${year}: only weekends count as non-business days (BR-004-31)`,
    );
  }
}
