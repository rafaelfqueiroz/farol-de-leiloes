import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import PlansCancelPage from './page';

describe('PlansCancelPage (frame r6)', () => {
  it.each(['light', 'dark'] as const)(
    'has one h1 inside a main and passes axe (%s)',
    async (scheme) => {
      const { container } = render(<PlansCancelPage />, { scheme });

      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: messages.plansResult.cancel.title }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Nenhuma cobrança foi feita/)).toBeVisible();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('takes the visitor back to the plans from its one action', () => {
    render(<PlansCancelPage />);

    expect(screen.getByRole('link', { name: messages.plansResult.cancel.back })).toHaveAttribute(
      'href',
      '/plans',
    );
  });
});
