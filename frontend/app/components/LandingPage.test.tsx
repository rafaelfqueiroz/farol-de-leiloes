import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import LandingPage from './LandingPage';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('LandingPage', () => {
  it('shows the headline with the discount through the percent formatter', () => {
    render(<LandingPage />);

    const headline = screen.getByRole('heading', { level: 2, name: /^Encontre o imóvel/ });
    expect(headline).toHaveTextContent('Encontre o imóvel dos seus sonhos com até 70% de desconto');
  });

  it('shows plan prices through the money formatter (AR-21)', () => {
    render(<LandingPage />);

    expect(screen.getByText(/^R\$\s0,00$/)).toBeInTheDocument();
    expect(screen.getByText(/^R\$\s29,90$/)).toBeInTheDocument();
    expect(screen.getByText('Em breve', { selector: 'h3' })).toBeInTheDocument();
  });

  it('disables the premium plan, which is not for sale yet', () => {
    render(<LandingPage />);

    expect(screen.getByRole('button', { name: 'Em breve' })).toBeDisabled();
    expect(within(document.body).getByRole('button', { name: 'Assinar Agora' })).toBeEnabled();
  });
});
