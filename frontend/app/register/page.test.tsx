import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders as render } from '@/test/render';
import RegisterPage from './page';

const env = vi.hoisted(() => ({ register: vi.fn(), push: vi.fn() }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: env.push }) }));
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => ({ register: env.register }) }));

beforeEach(() => {
  env.register.mockReset();
  env.push.mockReset();
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

describe('RegisterPage', () => {
  it('refuses passwords that differ', async () => {
    await fill('secret1', 'secret2');

    expect(await screen.findByRole('alert')).toHaveTextContent('As senhas não coincidem');
    expect(env.register).not.toHaveBeenCalled();
  });

  it('refuses a short password', async () => {
    await fill('abc', 'abc');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A senha deve ter pelo menos 6 caracteres',
    );
    expect(env.register).not.toHaveBeenCalled();
  });

  it('asks the person to verify the e-mail after signing up', async () => {
    env.register.mockResolvedValue(undefined);
    await fill('secret1', 'secret1');

    expect(env.push).toHaveBeenCalledWith('/verify-email');
  });
});
