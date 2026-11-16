import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api-error';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import RegisterPage from './page';

const env = vi.hoisted(() => ({ register: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ register: env.register }) }));

beforeEach(() => {
  env.register.mockReset();
  env.push.mockReset();
});

const TERMS = 'Li e aceito os Termos de uso e a Política de privacidade';

async function fill({
  password = 'secret-one',
  confirmation = password,
  accept = true,
}: { password?: string; confirmation?: string; accept?: boolean } = {}) {
  const user = userEvent.setup();
  render(<RegisterPage />);
  await user.type(screen.getByLabelText(/nome/i), 'Ana');
  await user.type(screen.getByLabelText(/^e-?mail/i), 'a@b.com');
  await user.type(screen.getByLabelText(/^senha/i), password);
  await user.type(screen.getByLabelText(/confirmar senha/i), confirmation);
  if (accept) await user.click(screen.getByRole('checkbox', { name: TERMS }));
  await user.click(screen.getByRole('button', { name: /^criar conta$/i }));
}

describe('RegisterPage', () => {
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

  it('BR-001-02: sends the acceptance with the sign-up', async () => {
    env.register.mockResolvedValue(undefined);
    await fill();

    expect(env.register).toHaveBeenCalledWith('a@b.com', 'secret-one', 'Ana');
    expect(env.push).toHaveBeenCalledWith('/verify-email');
  });

  it('frame 1.2: without the terms nothing is sent and the error sits under the block, tied to the box', async () => {
    await fill({ accept: false });

    const error = await screen.findByText('Aceite os termos para criar a conta');
    expect(env.register).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: TERMS })).toHaveAccessibleDescription(
      'Aceite os termos para criar a conta',
    );
    expect(error).toBeVisible();
    expect(await axe(document.body)).toHaveNoViolations();
  });

  it('clears the terms error once the box is ticked', async () => {
    const user = userEvent.setup();
    await fill({ accept: false });
    await user.click(screen.getByRole('checkbox', { name: TERMS }));

    expect(screen.queryByText('Aceite os termos para criar a conta')).not.toBeInTheDocument();
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
