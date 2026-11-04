import { afterEach, describe, expect, it, vi } from 'vitest';
import { ptBR } from 'date-fns/locale';
import { BrasiliaDateAdapter } from '@/lib/brasilia-date-adapter';
import { toUtcInstant } from '@/lib/dates';

const adapter = new BrasiliaDateAdapter({ locale: ptBR });

afterEach(() => vi.useRealTimers());

describe('BrasiliaDateAdapter construction boundaries (AR-23, DS-26)', () => {
  it('constructs now in Brasília for the picker empty-field reference', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2027-03-14T05:30:45.123Z'));

    expect(adapter.formatByString(adapter.date(), 'dd/MM/yyyy HH:mm:ss.SSS')).toBe(
      '14/03/2027 02:30:45.123',
    );
  });

  it('interprets MUI zone-less default bounds in Brasília and zoned ISO as an instant', () => {
    expect(
      adapter.formatByString(adapter.date('1900-01-01T00:00:00.000'), 'dd/MM/yyyy HH:mm'),
    ).toBe('01/01/1900 00:00');
    expect(
      adapter.formatByString(adapter.date('2099-12-31T00:00:00.000'), 'dd/MM/yyyy HH:mm'),
    ).toBe('31/12/2099 00:00');
    expect(adapter.formatByString(adapter.date('2027-03-14T05:30:00Z'), 'dd/MM/yyyy HH:mm')).toBe(
      '14/03/2027 02:30',
    );
  });

  it('accepts ISO construction strings, including a space delimiter, but rejects legacy strings', () => {
    expect(toUtcInstant(adapter.date('2027-03-14 02:30'))).toBe('2027-03-14T05:30:00.000Z');
    // AR-23: do not restore native Date's browser-dependent parsing for this private adapter.
    expect(adapter.isValid(adapter.date('Sun, 14 Mar 2027 05:30:00 GMT'))).toBe(false);
  });

  it('parses a pasted Brasília wall time without browser DST normalization', () => {
    const parsed = adapter.parse('14/03/2027 02:30', 'dd/MM/yyyy HH:mm');
    expect(parsed).not.toBeNull();
    if (parsed) expect(toUtcInstant(parsed)).toBe('2027-03-14T05:30:00.000Z');
  });

  it('keeps empty and invalid input editable', () => {
    expect(adapter.date(null)).toBeNull();
    expect(adapter.parse('', 'dd/MM/yyyy')).toBeNull();
    expect(adapter.isValid(adapter.parse('31/02/2027', 'dd/MM/yyyy'))).toBe(false);
    expect(adapter.isValid(adapter.date('invalid'))).toBe(false);
    expect(adapter.isValid(adapter.getInvalidDate())).toBe(false);
  });
});
