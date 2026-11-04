import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import DateField from './DateField';
import { DateFieldHost as Host } from '@/test/date-field-host';

describe('DateField (datetime)', () => {
  it.each([
    ['2027-03-14T05:30:45.000Z', 'true'],
    ['2027-03-14T05:30:50.122Z', 'true'],
    ['2027-03-14T05:30:50.123Z', 'false'],
    ['2027-03-14T05:30:50.124Z', 'false'],
    ['2027-03-14T05:30:55.000Z', 'false'],
  ])('validates untouched precise value %s against the exact minimum', (initial, invalid) => {
    const onValue = vi.fn();
    renderWithProviders(
      <Host type="datetime" initial={initial} min="2027-03-14T05:30:50.123Z" onValue={onValue} />,
    );

    expect(screen.getByRole('group', { name: 'Data e hora' })).toHaveAttribute(
      'aria-invalid',
      invalid,
    );
    expect(onValue).not.toHaveBeenCalled();
  });

  it('validates the whole-minute instant it emits after editing a precise parent', async () => {
    const onValue = vi.fn();
    renderWithProviders(
      <Host
        type="datetime"
        initial="2027-03-14T05:31:55.000Z"
        min="2027-03-14T05:30:50.123Z"
        onValue={onValue}
      />,
    );

    await userEvent.click(screen.getByRole('spinbutton', { name: 'Minutos' }));
    await userEvent.keyboard('{ArrowDown}');

    expect(onValue).toHaveBeenLastCalledWith('2027-03-14T05:30:00.000Z');
    expect(screen.getByRole('group', { name: 'Data e hora' })).toHaveAttribute(
      'aria-invalid',
      'true',
    );
    await userEvent.keyboard('{ArrowUp}');
    expect(onValue).toHaveBeenLastCalledWith('2027-03-14T05:31:00.000Z');
    expect(screen.getByRole('group', { name: 'Data e hora' })).toHaveAttribute(
      'aria-invalid',
      'false',
    );
  });

  it('keeps untouched parent precision and emits whole minutes only after editing', async () => {
    const onValue = vi.fn();
    const { container } = renderWithProviders(
      <Host type="datetime" initial="2027-03-14T05:30:45.123Z" onValue={onValue} />,
    );

    expect(container.querySelector('input')).toHaveValue('14/03/2027 02:30');
    expect(onValue).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('spinbutton', { name: 'Minutos' }));
    await userEvent.keyboard('{ArrowUp}');

    expect(onValue).toHaveBeenLastCalledWith('2027-03-14T05:31:00.000Z');
  });

  it('lets an invalid stored timestamp be corrected without breaking the form', async () => {
    const onValue = vi.fn();
    renderWithProviders(<Host type="datetime" initial="2026-03-10T15:30:00" onValue={onValue} />);

    await userEvent.click(screen.getByRole('spinbutton', { name: 'Dia' }));
    await userEvent.keyboard('100320262359');

    expect(onValue).toHaveBeenLastCalledWith('2026-03-11T02:59:00.000Z');
  });

  it.each(['light', 'dark'] as const)(
    'shows an instant as the Brasília wall clock and passes axe (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <Host type="datetime" initial="2026-03-11T02:59:00.000Z" helperText="Antes do leilão" />,
        { scheme },
      );

      // 02:59 UTC on the 11th is 23:59 on the 10th in Brasília, whatever the browser zone
      expect(screen.getByRole('group', { name: 'Data e hora' })).toBeInTheDocument();
      expect(container.querySelector('input')).toHaveValue('10/03/2026 23:59');
      expect(screen.getByText('Antes do leilão')).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('shows midnight in Brasília as 00:00 of the same day', () => {
    const { container } = renderWithProviders(
      <Host type="datetime" initial="2026-03-10T03:00:00.000Z" />,
    );

    expect(container.querySelector('input')).toHaveValue('10/03/2026 00:00');
  });

  it('shows 29 February', () => {
    const { container } = renderWithProviders(
      <Host type="datetime" initial="2028-03-01T02:59:00.000Z" />,
    );

    expect(container.querySelector('input')).toHaveValue('29/02/2028 23:59');
  });

  it('emits the typed Brasília time as a UTC instant', async () => {
    const onValue = vi.fn();
    renderWithProviders(<Host type="datetime" onValue={onValue} />);

    await userEvent.click(screen.getByRole('spinbutton', { name: 'Dia' }));
    await userEvent.keyboard('10032026');
    await userEvent.keyboard('2359');

    expect(onValue).toHaveBeenLastCalledWith('2026-03-11T02:59:00.000Z');
  });

  it('emits null, not a half-typed date, until the date is complete', async () => {
    const onValue = vi.fn();
    renderWithProviders(<Host type="datetime" onValue={onValue} />);

    await userEvent.click(screen.getByRole('spinbutton', { name: 'Dia' }));
    await userEvent.keyboard('10');

    expect(onValue).not.toHaveBeenCalledWith(expect.stringMatching(/Z$/));
  });

  it('follows a value the parent sets', () => {
    const { container, rerender } = renderWithProviders(
      <DateField
        label="Data e hora"
        type="datetime"
        value="2026-03-10T15:00:00.000Z"
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector('input')).toHaveValue('10/03/2026 12:00');

    rerender(
      <DateField
        label="Data e hora"
        type="datetime"
        value="2026-03-10T14:00:00.000Z"
        onChange={vi.fn()}
      />,
    );
    expect(container.querySelector('input')).toHaveValue('10/03/2026 11:00');
  });
});

describe('DateField (date)', () => {
  it.each(['light', 'dark'] as const)(
    'shows a calendar date as is and passes axe (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<Host initial="2028-02-29" label="Válido até" />, {
        scheme,
      });

      expect(container.querySelector('input')).toHaveValue('29/02/2028');
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('emits the typed day as YYYY-MM-DD, never shifted', async () => {
    const onValue = vi.fn();
    renderWithProviders(<Host onValue={onValue} />);

    await userEvent.click(screen.getByRole('spinbutton', { name: 'Dia' }));
    await userEvent.keyboard('31012026');

    expect(onValue).toHaveBeenLastCalledWith('2026-01-31');
  });
});
