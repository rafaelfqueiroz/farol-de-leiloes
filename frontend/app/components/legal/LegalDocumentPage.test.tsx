import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PRIVACY_DOCUMENT, TERMS_DOCUMENT } from '@/test/legal-fixtures';
import { axe, renderWithProviders } from '@/test/render';
import LegalDocumentPage, { LegalDocumentSkeleton } from './LegalDocumentPage';

// TS-19: real theme (both schemes), real catalogue, axe
describe('LegalDocumentPage', () => {
  it.each(['light', 'dark'] as const)(
    'shows the document in force, one h1 (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <LegalDocumentPage kind="terms" document={TERMS_DOCUMENT} />,
        { scheme },
      );

      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: 'Termos de Uso' })).toBeVisible();
      expect(screen.getByText('Versão 0.2')).toBeVisible();
      expect(screen.getByRole('heading', { level: 2, name: '1. O serviço' })).toBeVisible();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('shows the privacy policy under its own name', () => {
    renderWithProviders(<LegalDocumentPage kind="privacy" document={PRIVACY_DOCUMENT} />);

    expect(screen.getByRole('article', { name: 'Texto da política de privacidade' })).toBeVisible();
  });

  it.each(['light', 'dark'] as const)(
    'DS-19: when the API could not answer it says so, under the document name, with a retry (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <LegalDocumentPage kind="terms" document={null} />,
        { scheme },
      );

      expect(screen.getByRole('heading', { level: 1, name: 'Termos de uso' })).toBeVisible();
      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar o documento');
      expect(screen.getByRole('alert')).toHaveTextContent('Tente de novo em instantes.');
      expect(screen.getByRole('link', { name: 'Tentar de novo' })).toHaveAttribute(
        'href',
        '/termos',
      );
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('retries the privacy policy at its own address', () => {
    renderWithProviders(<LegalDocumentPage kind="privacy" document={null} />);

    expect(screen.getByRole('link', { name: 'Tentar de novo' })).toHaveAttribute(
      'href',
      '/privacidade',
    );
  });
});

describe('LegalDocumentSkeleton', () => {
  it.each(['light', 'dark'] as const)(
    'is a polite status that says it is loading (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<LegalDocumentSkeleton />, { scheme });

      expect(screen.getByRole('status')).toHaveTextContent('Carregando o documento');
      expect(await axe(container)).toHaveNoViolations();
    },
  );
});
