import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import LegalDocument from './LegalDocument';

const CONTENT = [
  '# Termos de Uso — esqueleto (versão 0.1)',
  '',
  '> **RASCUNHO — pendente de revisão jurídica.** Este documento é apenas uma lista.',
  '',
  '## 1. Objeto',
  '',
  '- Tópico: o que é o Farol.',
  '- Tópico: **negrito** e `código`.',
  '',
  '### 1.1 Detalhe',
  '',
  'Texto com [um link](https://example.com/regras) e [outro](mailto:dpo@example.com).',
  '',
  '## 2. Campos',
  '',
  '| Campo | Finalidade |',
  '| --- | --- |',
  '| `name` | Identificar |',
].join('\n');

function renderDocument(overrides: Partial<React.ComponentProps<typeof LegalDocument>> = {}) {
  return renderWithProviders(
    <LegalDocument
      kind="terms"
      title="Termos de Uso"
      version="0.1"
      effectiveAt="2026-11-19T03:00:00.000Z"
      draft
      content={CONTENT}
      {...overrides}
    />,
    { scheme: overrides.kind === 'privacy' ? 'dark' : 'light' },
  );
}

// TS-19: real theme, real catalogue, axe
describe('LegalDocument', () => {
  it.each(['light', 'dark'] as const)(
    'is a reading page with one h1 and passes axe (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <LegalDocument
          kind="privacy"
          title="Política de Privacidade"
          version="0.1"
          effectiveAt="2026-11-19T03:00:00.000Z"
          draft
          content={CONTENT}
        />,
        { scheme },
      );

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Política de Privacidade' }),
      ).toBeVisible();
      expect(
        screen.getByRole('article', { name: 'Texto da política de privacidade' }),
      ).toBeVisible();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('shows the version, the draft marker, and the day it took effect in Brasília time', () => {
    renderDocument();

    expect(screen.getByText('Versão 0.1')).toBeVisible();
    expect(screen.getByText('Rascunho')).toBeVisible();
    // 2026-11-19T03:00Z is midnight on the 19th in Brasília
    expect(screen.getByText('19/11/2026')).toBeVisible();
    expect(screen.getByText(/Em vigor desde/)).toHaveTextContent(
      'Em vigor desde 19/11/2026 (horário de Brasília)',
    );
  });

  it('announces the draft banner, and omits it, with the pill, for a reviewed text', () => {
    const { rerender } = renderDocument();

    const banner = screen.getByRole('status');
    expect(within(banner).getByText('Rascunho, pendente de revisão jurídica')).toBeVisible();

    rerender(
      <LegalDocument
        kind="terms"
        title="Termos de Uso"
        version="1.0"
        effectiveAt="2026-12-01T03:00:00.000Z"
        draft={false}
        content={CONTENT}
      />,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByText('Rascunho')).not.toBeInTheDocument();
  });

  it("does not repeat the document's own title: its headings start at h2 (DS-15)", () => {
    renderDocument();

    expect(screen.queryByText('Termos de Uso — esqueleto (versão 0.1)')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '1. Objeto' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 3, name: '1.1 Detalhe' })).toBeVisible();
  });

  it('renders lists, emphasis, code, a table inside a focusable named region, and safe links', () => {
    renderDocument();

    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('negrito').tagName).toBe('STRONG');
    expect(screen.getByText('código').tagName).toBe('CODE');
    const region = screen.getByRole('region', { name: 'Tabela: 2. Campos' });
    expect(region).toHaveAttribute('tabindex', '0');
    expect(within(region).getByRole('columnheader', { name: 'Campo' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'um link' })).toHaveAttribute(
      'href',
      'https://example.com/regras',
    );
    expect(screen.getByRole('link', { name: 'outro' })).toHaveAttribute(
      'href',
      'mailto:dpo@example.com',
    );
  });

  it('SC-20: hostile text becomes inert text, never markup, a script or an unsafe link', async () => {
    const hostile = [
      '## Seção <img src=x onerror="window.__pwned=1">',
      '',
      '<script>window.__pwned = 1</script>',
      '',
      '[clique](javascript:window.__pwned=1) e [dados](data:text/html,<b>x</b>)',
      '',
      '<a href="javascript:alert(1)">cru</a>',
      '',
      '| a | b |',
      '| - | - |',
      '| <b>x</b> | [y](javascript:alert(1)) |',
    ].join('\n');

    const { container } = renderDocument({ content: hostile });

    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    for (const anchor of container.querySelectorAll('a')) {
      expect(anchor.getAttribute('href')).not.toMatch(/^(javascript|data):/i);
    }
    expect(screen.queryByRole('link', { name: 'clique' })).not.toBeInTheDocument();
    expect(screen.getByText(/<script>window.__pwned = 1<\/script>/)).toBeVisible();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    expect(await axe(container)).toHaveNoViolations();
  });
});
