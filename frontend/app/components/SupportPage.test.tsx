import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders as render } from '@/test/render';
import SupportPage from './SupportPage';

describe('SupportPage', () => {
  it('has one h1 with the FAQ and the form as h2 sections (DS-15)', () => {
    render(<SupportPage />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Suporte' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Perguntas frequentes', 'Enviar solicitação']);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('lists the FAQ questions as accordions and keeps the submit disabled while empty', () => {
    render(<SupportPage />);

    expect(screen.getAllByRole('button', { expanded: false }).length).toBeGreaterThanOrEqual(6);
    expect(screen.getByRole('button', { name: /enviar solicitação/i })).toBeDisabled();
  });

  it.each(['light', 'dark'] as const)('has no accessibility violations in %s', async (scheme) => {
    // the AppShell owns <main> (#42), so the landmark is supplied here
    const { baseElement } = render(
      <main>
        <SupportPage />
      </main>,
      { scheme },
    );
    expect(await axe(baseElement)).toHaveNoViolations();
  });
});
