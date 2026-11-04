import { TZDate } from '@date-fns/tz';
import { ptBR } from 'date-fns/locale';
import { describe, expect, it } from 'vitest';
import { AdapterDateFnsBrasilia } from '@/lib/adapter-date-fns-brasilia';
import { TIME_ZONE } from '@/i18n/config';

const adapter = new AdapterDateFnsBrasilia({ locale: ptBR });
const utc = (date: Date) => new Date(date.getTime()).toISOString();

describe('AR-23 / DS-26 Brasília date-fns picker adapter', () => {
  it('constructs zoned instants and internal calendar references in Brasília', () => {
    expect(adapter.formatByString(adapter.date('2027-01-01T01:30:00Z'), 'dd/MM/yyyy HH:mm')).toBe(
      '31/12/2026 22:30',
    );
    expect(utc(adapter.date('2027-01-01'))).toBe('2027-01-01T03:00:00.000Z');
    expect(utc(adapter.date('2027-01-01T00:00:00'))).toBe('2027-01-01T03:00:00.000Z');
    expect(adapter.date(null)).toBeNull();
    expect(adapter.date()).toBeInstanceOf(TZDate);
  });

  it('parses typed Brazilian dates and preserves UTC through calendar/time edits', () => {
    const parsed = adapter.parse('31/12/2026 22:30', 'dd/MM/yyyy HH:mm');
    expect(parsed).not.toBeNull();
    if (!parsed) throw new Error('Expected a parsed date');
    expect(utc(parsed)).toBe('2027-01-01T01:30:00.000Z');
    expect(utc(adapter.setHours(adapter.addDays(parsed, 1), 23))).toBe('2027-01-02T02:30:00.000Z');
    expect(adapter.parse('', 'dd/MM/yyyy')).toBeNull();
    expect(adapter.isValid(adapter.parse('31/02/2027', 'dd/MM/yyyy'))).toBe(false);
  });

  it('normalizes an incoming plain Date without changing its instant', () => {
    const date = adapter.setTimezone(new Date('2027-01-01T01:30:00Z'));
    expect(adapter.getTimezone()).toBe(TIME_ZONE);
    expect(adapter.getHours(date)).toBe(22);
    expect(utc(date)).toBe('2027-01-01T01:30:00.000Z');
  });
});
