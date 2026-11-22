import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import messages from '@/messages/pt-BR.json';
import { CURRENT_LEGAL, currentLegalResponse } from '@/test/legal-fixtures';
import { axe, renderWithProviders as render } from '@/test/render';
import RegisterPage from './page';

const env = vi.hoisted(() => ({ register: vi.fn(), push: vi.fn(), authLoading: false }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ register: env.register, loading: env.authLoading }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  // SPEC-010 BR-010-01: the form reads the versions in force from the public API
  fetchMock.mockReset().mockImplementation(() => Promise.resolve(currentLegalResponse()));
  vi.stubGlobal('fetch', fetchMock);
  env.register.mockReset();
  env.push.mockReset();
  env.authLoading = false;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const TERMS = 'Li e aceito os Termos de uso e a Política de privacidade.';
const WHATSAPP = 'Quero receber avisos por WhatsApp (opcional).';

async function fill({
  password = 'secret-one',
  confirmation = password,
  accept = true,
  whatsapp = false,
}: { password?: string; confirmation?: string; accept?: boolean; whatsapp?: boolean } = {}) {
  const user = userEvent.setup();
  render(<RegisterPage />);
  // the submit stays off until the versions in force are known
  await screen.findByText(/Versões vigentes/);
  await user.type(screen.getByLabelText(/nome/i), 'Ana');
  await user.type(screen.getByLabelText(/^e-?mail/i), 'a@b.com');
  await user.type(screen.getByLabelText(/^senha/i), password);
  await user.type(screen.getByLabelText(/confirmar senha/i), confirmation);
  if (accept) await user.click(screen.getByRole('checkbox', { name: TERMS }));
  if (whatsapp) await user.click(screen.getByRole('checkbox', { name: WHATSAPP }));
  await user.click(screen.getByRole('button', { name: /^criar conta$/i }));
}

describe('RegisterPage while the first session lookup is pending (BR-001-18)', () => {
  // A registration that raced the lookup would be undone by the lookup's anonymous answer.
  it('disables the submit button, with the same label, until the lookup is done', () => {
    env.authLoading = true;
    render(<RegisterPage />);

    expect(screen.getByRole('button', { name: /^criar conta$/i })).toBeDisabled();
  });

  it('does not submit a valid form (Enter in a field) while the lookup is pending', async () => {
    env.authLoading = true;
    const user = userEvent.setup();
    render(<RegisterPage />);
    await user.type(screen.getByLabelText(/nome/i), 'Ana');
    await user.type(screen.getByLabelText(/e-?mail/i), 'a@b.com');
    await user.type(screen.getByLabelText(/^senha/i), 'secret123');
    await user.type(screen.getByLabelText(/confirmar senha/i), 'secret123');

    fireEvent.submit(screen.getByRole('button', { name: /^criar conta$/i }));

    expect(env.register).not.toHaveBeenCalled();
  });

  it('enables the submit button once the lookup is done and the versions are known', async () => {
    render(<RegisterPage />);

    expect(screen.getByRole('button', { name: /^criar conta$/i })).toBeDisabled();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^criar conta$/i })).toBeEnabled(),
    );
  });
});

describe('RegisterPage', () => {
  it.each(['light', 'dark'] as const)(
    'SPEC-010 frame "Cadastro": the terms with their links and versions, and the optional unticked WhatsApp box (%s)',
    async (scheme) => {
      const { container } = render(<RegisterPage />, { scheme });
      await screen.findByText(/Versões vigentes: termos 0.2 e política 0.2 \(rascunho\)\./);

      const block = within(screen.getByRole('group', { name: 'Termos e privacidade' }));
      expect(block.getByRole('checkbox', { name: TERMS })).not.toBeChecked();
      expect(block.getByRole('checkbox', { name: WHATSAPP })).not.toBeChecked();
      expect(block.getByRole('link', { name: 'Termos de uso' })).toHaveAttribute('href', '/termos');
      expect(block.getByRole('link', { name: 'Política de privacidade' })).toHaveAttribute(
        'href',
        '/privacidade',
      );
      // both documents open in a new tab, so the form is not lost
      expect(block.getByRole('link', { name: 'Termos de uso' })).toHaveAttribute(
        'target',
        '_blank',
      );
      expect(block.getByRole('checkbox', { name: WHATSAPP })).toHaveAccessibleDescription(
        /nenhuma mensagem sai sem você ativar o canal/,
      );
      expect(
        screen.getByText(/Com o Google, mostramos os termos antes de criar a conta/),
      ).toBeVisible();
      // BR-010-02: the footer with the legal links ends the form screens
      expect(screen.getByRole('contentinfo')).toBeVisible();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('frame 1: has one h1 "Criar conta" in a main, the fields, the terms, Google and the sign-in link', async () => {
    const { container } = render(<RegisterPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Criar conta' })).toBeInTheDocument();
    expect(screen.getByText(messages.register.subtitle)).toBeInTheDocument();
    expect(screen.getByLabelText(/^senha/i)).toHaveAccessibleDescription('De 8 a 128 caracteres');
    expect(screen.getByLabelText(/^senha/i)).toHaveAttribute('maxlength', '128');
    expect(screen.getByRole('checkbox', { name: TERMS })).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'Entrar com Google' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Já tenho conta' })).toHaveAttribute('href', '/login');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('BR-001-02, BR-010-01: sends the acceptance with the versions the form showed, WhatsApp false by default', async () => {
    env.register.mockResolvedValue(undefined);
    await fill();

    expect(env.register).toHaveBeenCalledWith('a@b.com', 'secret-one', 'Ana', {
      termsVersion: CURRENT_LEGAL.terms.version,
      privacyVersion: CURRENT_LEGAL.privacy.version,
      whatsappConsent: false,
    });
    expect(env.push).toHaveBeenCalledWith('/verify-email');
  });

  it('BR-010-27: sends whatsappConsent true only when the person ticked the box', async () => {
    env.register.mockResolvedValue(undefined);
    await fill({ whatsapp: true });

    expect(env.register).toHaveBeenCalledWith(
      'a@b.com',
      'secret-one',
      'Ana',
      expect.objectContaining({ whatsappConsent: true }),
    );
  });

  it('BR-010-01: TERMS_VERSION_OUTDATED says the documents changed, reads the new versions, clears the box and creates nothing', async () => {
    env.register.mockRejectedValue(new ApiError('TERMS_VERSION_OUTDATED', {}, 409));
    await fill();

    const alert = await screen.findByRole('status');
    expect(alert).toHaveTextContent('Os documentos mudaram');
    expect(screen.getByRole('link', { name: 'Ler as novas versões' })).toHaveAttribute(
      'href',
      '/termos',
    );
    await waitFor(() => expect(screen.getByRole('checkbox', { name: TERMS })).not.toBeChecked());
    expect(fetchMock.mock.calls.filter(([url]) => url === '/api/legal/current')).toHaveLength(2);
    expect(env.push).not.toHaveBeenCalled();
  });

  it('does not submit, and offers a retry, when the versions in force cannot be loaded', async () => {
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(
        new Response(JSON.stringify({ code: 'BACKEND_UNAVAILABLE', context: {} }), { status: 502 }),
      ),
    );
    const user = userEvent.setup();
    render(<RegisterPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível carregar as versões vigentes dos documentos.',
    );
    expect(screen.getByRole('button', { name: /^criar conta$/i })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Tentar de novo' }));
    await screen.findByText(/Versões vigentes/);
    expect(screen.getByRole('button', { name: /^criar conta$/i })).toBeEnabled();
  });

  it('frame 1.2: without the terms nothing is sent and the error sits under the block, tied to the box', async () => {
    await fill({ accept: false });

    const error = await screen.findByText('Aceite os termos e a política para criar a conta.');
    expect(env.register).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: TERMS })).toHaveAccessibleDescription(
      expect.stringContaining('Aceite os termos e a política para criar a conta.'),
    );
    expect(error).toBeVisible();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('clears the terms error once the box is ticked', async () => {
    const user = userEvent.setup();
    await fill({ accept: false });
    await user.click(screen.getByRole('checkbox', { name: TERMS }));

    expect(
      screen.queryByText('Aceite os termos e a política para criar a conta.'),
    ).not.toBeInTheDocument();
  });

  it('refuses passwords that differ, under the confirmation field', async () => {
    await fill({ password: 'secret-one', confirmation: 'secret-two' });

    expect(await screen.findByLabelText(/confirmar senha/i)).toHaveAccessibleDescription(
      'As senhas não coincidem',
    );
    expect(env.register).not.toHaveBeenCalled();
  });

  it('refuses a short password, under the password field', async () => {
    await fill({ password: 'abc' });

    expect(await screen.findByLabelText(/^senha/i)).toHaveAccessibleDescription(
      'Use de 8 a 128 caracteres',
    );
    expect(env.register).not.toHaveBeenCalled();
  });

  it('frame 1.2: EMAIL_ALREADY_REGISTERED reads "Este e-mail já tem cadastro" under the e-mail field', async () => {
    env.register.mockRejectedValue(new ApiError('EMAIL_ALREADY_REGISTERED', {}, 409));
    await fill();

    expect(await screen.findByLabelText(/^e-?mail/i)).toHaveAccessibleDescription(
      'Este e-mail já tem cadastro',
    );
    expect(env.push).not.toHaveBeenCalled();
  });

  it('shows any other failure in the alert at the top of the card', async () => {
    env.register.mockRejectedValue(new ApiError('INTERNAL_ERROR', {}, 500));
    await fill();

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.INTERNAL_ERROR);
  });
});
