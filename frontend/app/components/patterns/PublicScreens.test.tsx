import InfoOutlined from '@mui/icons-material/InfoOutlined';
import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import { AuthFormPage, LoadingScreen, ResultScreen } from './PublicScreens';

describe('AuthFormPage', () => {
  it.each(['light', 'dark'] as const)(
    'renders the logo, one h1 with its summary and the form inside a main (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <AuthFormPage title="Entrar" summary="Entre para acessar sua conta">
          <button type="button">Enviar</button>
        </AuthFormPage>,
        { scheme },
      );

      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: 'Entrar' })).toBeInTheDocument();
      expect(screen.getByText('Entre para acessar sua conta')).toBeInTheDocument();
      expect(screen.getByRole('img', { name: /farol dos leilões/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Enviar' })).toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('keeps the width narrow', () => {
    renderWithProviders(<AuthFormPage title="Entrar">conteúdo</AuthFormPage>);

    expect(getComputedStyle(screen.getByRole('main')).maxWidth).toBe('480px');
  });
});

describe('ResultScreen', () => {
  it.each(['light', 'dark'] as const)(
    'renders the icon, one h1, the text and the action inside a main (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(
        <ResultScreen tone="success" icon={InfoOutlined} title="Tudo certo" description="Texto">
          <button type="button">Seguir</button>
        </ResultScreen>,
        { scheme },
      );

      expect(screen.getByRole('main')).toBeInTheDocument();
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: 'Tudo certo' })).toBeInTheDocument();
      expect(screen.getByText('Texto')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Seguir' })).toBeInTheDocument();
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('shows a spinner in place of the icon while loading', () => {
    renderWithProviders(<ResultScreen loading title="Verificando" />);

    expect(screen.getByRole('heading', { level: 1, name: 'Verificando' })).toBeInTheDocument();
    expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
  });
});

describe('LoadingScreen', () => {
  it('exposes a visually hidden h1 next to the spinner and passes axe', async () => {
    const { container } = renderWithProviders(<LoadingScreen title="Autenticando…" />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Autenticando…' })).toBeInTheDocument();
    expect(document.querySelector('.MuiCircularProgress-root')).toBeInTheDocument();
    expect(await axe(container)).toHaveNoViolations();
  });
});
