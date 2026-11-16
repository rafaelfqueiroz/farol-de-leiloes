import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import RegisterPage from './page';

const env = vi.hoisted(() => ({ register: vi.fn(), push: vi.fn(), authLoading: false }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({ register: env.register, loading: env.authLoading }),
}));

beforeEach(() => {
  env.register.mockReset();
  env.push.mockReset();
  env.authLoading = false;
});

async function fill(password: string, confirmation: string) {
  const user = userEvent.setup();
  render(<RegisterPage />);
  await user.type(screen.getByLabelText(/nome/i), 'Ana');
  await user.type(screen.getByLabelText(/e-?mail/i), 'a@b.com');
  await user.type(screen.getByLabelText(/^senha/i), password);
  await user.type(screen.getByLabelText(/confirmar senha/i), confirmation);
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

  it('enables the submit button once the lookup is done', () => {
    render(<RegisterPage />);

    expect(screen.getByRole('button', { name: /^criar conta$/i })).toBeEnabled();
  });
});

describe('RegisterPage', () => {
  it('has one h1 "Criar conta" inside a main, with the old subtitle as its summary', async () => {
    const { container } = render(<RegisterPage />);

    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Criar conta' })).toBeInTheDocument();
    expect(screen.getByText(messages.register.subtitle)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Entrar' })).toHaveAttribute('href', '/login');
    expect(await axe(container)).toHaveNoViolations();
  });

  it('refuses passwords that differ', async () => {
    await fill('secret-one', 'secret-two');

    expect(await screen.findByRole('alert')).toHaveTextContent('As senhas não coincidem');
    expect(env.register).not.toHaveBeenCalled();
  });

  it('refuses a short password', async () => {
    await fill('abc', 'abc');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A senha deve ter pelo menos 8 caracteres',
    );
    expect(env.register).not.toHaveBeenCalled();
  });

  it('asks the person to verify the e-mail after signing up', async () => {
    env.register.mockResolvedValue(undefined);
    await fill('secret-one', 'secret-one');

    expect(env.push).toHaveBeenCalledWith('/verify-email');
  });
});
