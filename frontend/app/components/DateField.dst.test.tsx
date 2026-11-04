import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/render';
import { DateFieldHost as Host } from '@/test/date-field-host';

// TS-11, AR-23: only zone-sensitive real-picker paths run in all three native worker zones.
describe('DateField timezone regressions (#86)', () => {
  it('shows Brasília 02:30 in a browser DST gap (AR-23, #86)', () => {
    const onValue = vi.fn();
    const { container } = renderWithProviders(
      <Host type="datetime" initial="2027-03-14T05:30:00.000Z" onValue={onValue} />,
    );

    expect(container.querySelector('input')).toHaveValue('14/03/2027 02:30');
    // Display alone does not rewrite the parent API string.
    expect(onValue).not.toHaveBeenCalled();
  });

  it('edits the real picker during a browser DST gap and emits Brasília UTC (#86)', async () => {
    const onValue = vi.fn();
    renderWithProviders(
      <Host type="datetime" initial="2027-03-14T05:30:00.000Z" onValue={onValue} />,
    );

    await userEvent.click(screen.getByRole('spinbutton', { name: 'Minutos' }));
    await userEvent.keyboard('{ArrowUp}');

    // Brasília 02:31 = 05:31 UTC; LA's nonexistent local 02:31 must not become 03:31.
    expect(onValue).toHaveBeenLastCalledWith('2027-03-14T05:31:00.000Z');
  });

  it('types a Brasília gap time into an empty picker', async () => {
    const onValue = vi.fn();
    const { container } = renderWithProviders(<Host type="datetime" onValue={onValue} />);

    await userEvent.click(screen.getByRole('spinbutton', { name: 'Dia' }));
    await userEvent.keyboard('140320270230');

    expect(container.querySelector('input')).toHaveValue('14/03/2027 02:30');
    expect(onValue).toHaveBeenLastCalledWith('2027-03-14T05:30:00.000Z');
  });

  it('pastes a Brasília gap time into the actual picker', async () => {
    const user = userEvent.setup();
    const onValue = vi.fn();
    const { container } = renderWithProviders(<Host type="datetime" onValue={onValue} />);

    await user.click(screen.getByRole('spinbutton', { name: 'Dia' }));
    await user.paste('14/03/2027 02:30');

    expect(container.querySelector('input')).toHaveValue('14/03/2027 02:30');
    expect(onValue).toHaveBeenLastCalledWith('2027-03-14T05:30:00.000Z');
  });

  it('shows an ordinary instant in Brasília across a UTC day boundary', () => {
    const { container } = renderWithProviders(
      <Host type="datetime" initial="2026-03-11T02:59:00.000Z" />,
    );
    expect(container.querySelector('input')).toHaveValue('10/03/2026 23:59');
  });

  it('edits a calendar date on the browser DST transition without shifting the day', async () => {
    const onValue = vi.fn();
    const { container } = renderWithProviders(<Host initial="2027-03-14" onValue={onValue} />);

    expect(container.querySelector('input')).toHaveValue('14/03/2027');
    await userEvent.click(screen.getByRole('spinbutton', { name: 'Dia' }));
    await userEvent.keyboard('{ArrowUp}');

    expect(container.querySelector('input')).toHaveValue('15/03/2027');
    expect(onValue).toHaveBeenLastCalledWith('2027-03-15');
  });
});
