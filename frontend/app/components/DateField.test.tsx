import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import DateField, { type DateFieldProps } from './DateField';

// A controlled host, like the dialogs that use the field.
function Host({
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

describe('DateField (datetime)', () => {
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
