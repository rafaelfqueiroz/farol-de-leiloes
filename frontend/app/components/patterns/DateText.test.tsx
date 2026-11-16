import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import DateText from './DateText';

const now = new Date('2026-03-10T15:00:00Z'); // 12:00 in Brasília

describe('DateText', () => {
  it.each(['light', 'dark'] as const)(
    'keeps invalid timestamps readable without emitting an invalid time element (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <DateText value="2027-01-01T01:30:00" withTime relative now={now} />,
        { scheme },
      );

      expect(screen.getByText('Data indisponível')).toBeInTheDocument();
      expect(container.querySelector('time')).toBeNull();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it.each(['light', 'dark'] as const)(
    'renders a <time> with the datetime and passes axe (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<DateText value="2026-03-10T15:30:00Z" />, {
        scheme,
      });

      const time = screen.getByText('10/03/2026');
      expect(time.tagName).toBe('TIME');
      expect(time).toHaveAttribute('datetime', '2026-03-10T15:30:00.000Z');
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('formats date and time in Brasília', () => {
    renderWithProviders(<DateText value="2026-03-10T15:30:00Z" withTime />);

    const time = screen.getByText('10/03/2026 12:30');
    expect(time.tagName).toBe('TIME');
  });

  // BR-003-23, BR-003-26: this file runs under several device zones (vitest.config.ts); the text
  // is the Brasília one in each.
  it('marks a time of day as Brasília time', () => {
    const { container } = renderWithProviders(<DateText value="2026-01-26T13:00:00Z" withTime />);

    expect(container.textContent).toBe('26/01/2026 10:00 (horário de Brasília)');
  });

  it('shows the Brasília day for 02:30 UTC, which is still the evening before', () => {
    const { container } = renderWithProviders(<DateText value="2026-02-01T02:30:00Z" withTime />);

    expect(container.textContent).toBe('31/01/2026 23:30 (horário de Brasília)');
  });

  it('puts the marker before the relative phrase', () => {
    const { container } = renderWithProviders(
      <DateText value="2026-03-10T13:00:00Z" withTime relative now={now} />,
    );

    expect(container.textContent).toBe('10/03/2026 10:00 (horário de Brasília) · há 2 horas');
  });

  it('does not name a zone next to a date without a time', () => {
    const { container } = renderWithProviders(<DateText value="2026-01-26T13:00:00Z" />);

    expect(container.textContent).toBe('26/01/2026');
  });

  it('does not shift a calendar date', () => {
    renderWithProviders(<DateText value="2026-03-10" withTime />);

    const time = screen.getByText('10/03/2026');
    expect(time).toHaveAttribute('datetime', '2026-03-10');
    // a calendar date has no time of day, so no clock to name
    expect(screen.queryByText(/horário de Brasília/)).toBeNull();
  });

  it('appends a future relative phrase and keeps the absolute date', () => {
    const { container } = renderWithProviders(<DateText value="2026-03-24" relative now={now} />);

    expect(screen.getByText('24/03/2026')).toBeInTheDocument();
    expect(container).toHaveTextContent('24/03/2026 · em 14 dias');
  });

  it('appends a past relative phrase in hours', () => {
    const { container } = renderWithProviders(
      <DateText value="2026-03-10T13:00:00Z" withTime relative now={now} />,
    );

    expect(container).toHaveTextContent('há 2 horas');
  });

  it('uses the singular and "hoje"', () => {
    const { container } = renderWithProviders(
      <>
        <DateText value="2026-03-11" relative now={now} />
        <DateText value="2026-03-10" relative now={now} />
      </>,
    );

    expect(container).toHaveTextContent('em 1 dia');
    expect(container).toHaveTextContent('hoje');
  });

  it('shows no relative phrase unless asked', () => {
    const { container } = renderWithProviders(<DateText value="2026-03-24" now={now} />);

    expect(container.textContent).toBe('24/03/2026');
  });
});
