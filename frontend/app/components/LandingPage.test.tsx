import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import LandingPage from './LandingPage';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe('LandingPage', () => {
  it('shows the headline with the discount through the percent formatter', () => {
    render(<LandingPage />);

    const headline = screen.getByRole('heading', { level: 1, name: /^Encontre o imóvel/ });
    expect(headline).toHaveTextContent('Encontre o imóvel dos seus sonhos com até 70% de desconto');
  });

  it('shows plan prices through the money formatter (AR-21)', () => {
    render(<LandingPage />);

    expect(screen.getByText(/^R\$\s0,00$/)).toBeInTheDocument();
    expect(screen.getByText(/^R\$\s29,90$/)).toBeInTheDocument();
    // a price is a figure, not a heading
    expect(screen.getByText('Em breve', { selector: 'p' })).toBeInTheDocument();
  });

  it('has exactly one h1, with the sections as h2 and their cards as h3 (DS-15)', () => {
    render(<LandingPage />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual([
      'Por que usar o Farol dos Leilões?',
      'Como funciona?',
      'Escolha seu Plano',
      'Pronto para encontrar seu imóvel?',
    ]);
    expect(screen.getByRole('heading', { level: 3, name: 'Gratuito' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 4 })).not.toBeInTheDocument();
  });

  it('disables the premium plan, which is not for sale yet', () => {
    render(<LandingPage />);

    expect(screen.getByRole('button', { name: 'Em breve' })).toBeDisabled();
    expect(within(document.body).getByRole('button', { name: 'Assinar Agora' })).toBeEnabled();
  });
});
