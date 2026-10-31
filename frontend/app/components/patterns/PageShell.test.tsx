import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import PageShell from './PageShell';

describe('PageShell', () => {
  it.each(['light', 'dark'] as const)('stacks its children and passes axe (%s)', async (scheme) => {
    const { container } = renderWithProviders(
      <PageShell>
        <p>Primeira seção</p>
        <p>Segunda seção</p>
      </PageShell>,
      { scheme },
    );

    expect(screen.getByText('Primeira seção')).toBeInTheDocument();
    expect(screen.getByText('Segunda seção')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('does not add a <main> landmark: the shell owns it', () => {
    renderWithProviders(<PageShell>conteúdo</PageShell>);

    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it.each([
    [undefined, '1200px'],
    ['app', '1200px'],
    ['reading', '720px'],
  ] as const)('caps the width for %s at %s', (width, expected) => {
    const { container } = renderWithProviders(<PageShell width={width}>conteúdo</PageShell>);

    expect(getComputedStyle(container.firstElementChild as Element).maxWidth).toBe(expected);
  });
});
