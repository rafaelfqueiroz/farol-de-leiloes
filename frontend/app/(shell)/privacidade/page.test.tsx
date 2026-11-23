import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CURRENT_LEGAL } from '@/test/legal-fixtures';
import { renderWithProviders } from '@/test/render';

const env = vi.hoisted(() => ({ legal: vi.fn() }));
vi.mock('@/lib/legal-server', () => ({ fetchCurrentLegal: env.legal }));
vi.mock('next-intl/server', async () => {
  const messages = (await import('@/messages/pt-BR.json')).default;
  return {
    getTranslations: async (namespace: string) => (key: string) =>
      (
        namespace
          .split('.')
          .reduce<unknown>(
            (node, part) => (node as Record<string, unknown>)[part],
            messages,
          ) as Record<string, string>
      )[key],
  };
});

import Page, { generateMetadata } from './page';
import Loading from './loading';

beforeEach(() => env.legal.mockReset());

// SPEC-010 BR-010-02: public, read on the server from the API's current version
describe('/privacidade', () => {
  it('renders the privacy document in force', async () => {
    env.legal.mockResolvedValue(CURRENT_LEGAL);

    renderWithProviders(await Page());

    expect(
      screen.getByRole('heading', { level: 1, name: CURRENT_LEGAL.privacy.title }),
    ).toBeVisible();
  });

  it('renders the error state, not a blank page, when the API cannot answer', async () => {
    env.legal.mockResolvedValue(null);

    renderWithProviders(await Page());

    expect(
      screen.getByRole('heading', { level: 1, name: 'Política de privacidade' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toBeVisible();
  });

  it('has its own title and a loading state', async () => {
    expect(await generateMetadata()).toEqual({ title: 'Política de privacidade' });
    renderWithProviders(<Loading />);
    expect(screen.getByRole('status')).toHaveTextContent('Carregando o documento');
  });
});
