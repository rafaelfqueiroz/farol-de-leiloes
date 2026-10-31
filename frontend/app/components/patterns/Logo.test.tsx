import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import Logo from './Logo';

describe('Logo', () => {
  it.each(['light', 'dark'] as const)('names the lockup once and passes axe (%s)', async (scheme) => {
    const { container } = renderWithProviders(<Logo variant="lockup" />, { scheme });

    // the svg carries the name; the live wordmark is hidden so it is not announced twice
    expect(screen.getAllByRole('img', { name: 'Farol dos Leilões' })).toHaveLength(1);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('splits the wordmark into "Farol" and "dos Leilões"', () => {
    const { container } = renderWithProviders(<Logo variant="lockup" />);

    const wordmark = container.querySelector('[aria-hidden="true"]') as HTMLElement;
    expect(wordmark.textContent).toBe('Farol dos Leilões');
    expect(wordmark.querySelector('span')).toHaveTextContent('dos Leilões');
  });

  it('renders only the named mark for the mark variant', () => {
    const { container } = renderWithProviders(<Logo variant="mark" size={24} />);

    expect(screen.getByRole('img', { name: 'Farol dos Leilões' })).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toHaveStyle({ width: '24px', height: '24px' });
  });

  it('draws the mark with palette variables, not hex colours', () => {
    const { container } = renderWithProviders(<Logo variant="mark" />);

    const html = container.innerHTML;
    expect(html).not.toMatch(/fill="#/i);
    expect(container.querySelectorAll('svg > *')).toHaveLength(8);
    const fillOf = (selector: string) =>
      getComputedStyle(container.querySelector(selector) as Element).fill;
    expect(fillOf('.tower')).toContain('--mui-palette-primary-main');
    expect(fillOf('.beam')).toContain('--mui-palette-secondary-main');
    expect(fillOf('.band')).toContain('--mui-palette-background-paper');
  });
});
