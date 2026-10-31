import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import StatusBadge, { type Status } from './StatusBadge';

const labels: Record<Status, string> = {
  onTime: 'No prazo',
  late: 'Atrasada',
  done: 'Concluída',
  cancelled: 'Cancelada',
  neutral: 'Não iniciada',
};

describe('StatusBadge', () => {
  it.each(['light', 'dark'] as const)('shows every status label and passes axe (%s)', async (scheme) => {
    const { container } = renderWithProviders(
      <>
        {(Object.keys(labels) as Status[]).map((status) => (
          <StatusBadge key={status} status={status} />
        ))}
      </>,
      { scheme },
    );

    for (const label of Object.values(labels)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(await axe(container)).toHaveNoViolations();
  });

  it('hides the dot from assistive tech so only the label is read', () => {
    renderWithProviders(<StatusBadge status="late" />);

    const dot = screen.getByText('Atrasada').querySelector('[aria-hidden="true"]');
    expect(dot).toBeInTheDocument();
  });

  it('draws a hollow dot for cancelled and a solid one for the rest', () => {
    renderWithProviders(
      <>
        <StatusBadge status="cancelled" />
        <StatusBadge status="done" />
      </>,
    );

    const dotOf = (label: string) =>
      getComputedStyle(screen.getByText(label).firstElementChild as Element);
    expect(dotOf('Cancelada').borderTopStyle).toBe('solid');
    expect(dotOf('Concluída').borderTopStyle).not.toBe('solid');
  });
});
