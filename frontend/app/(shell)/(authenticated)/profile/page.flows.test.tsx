import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import ProfilePage from './page';

// SPEC-001: the profile page. What it shows from GET /auth/profile/full, what each of its three
// forms sends, and how a refusal is told (AR-38/AR-39). TS-27: every person below is made up.
const env = vi.hoisted(() => ({
  auth: {} as Record<string, unknown>,
  loadUser: vi.fn(),
  report: vi.fn(),
}));
const fetchMock = vi.fn();

vi.mock('@/app/contexts/AuthContext', () => ({ useAuth: () => env.auth }));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));

type Answer = { status: number; body?: unknown };
let answers: Record<string, Answer>;

const fullProfile = {
  phone: '(00) 00000-0000',
  cpf: '000.000.000-00',
  dateOfBirth: '1990-05-17T00:00:00.000Z',
  sex: 'female',
  address: { street: 'Rua Exemplo, 1', city: 'Natal', state: 'RN', zipCode: '00000-000' },
};

function signIn(providers: string[], authenticated = true) {
  const user = { _id: 'u1', name: 'Ana Teste', email: 'ana@exemplo.test', providers };
  env.auth = {
    user,
    isAuthenticated: authenticated,
    loading: false,
    loadUser: env.loadUser,
  };
}

beforeEach(() => {
  window.localStorage.setItem('token', 'jwt-1');
  env.loadUser.mockReset();
  env.report.mockReset();
  answers = { '/api/auth/profile/full': { status: 200, body: fullProfile } };
  fetchMock.mockImplementation(async (url: string) => {
    const answer = answers[url];
    if (!answer) throw new Error(`unexpected request ${url}`);
    return { ok: answer.status < 400, status: answer.status, json: async () => answer.body ?? {} };
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const callsTo = (url: string) => fetchMock.mock.calls.filter(([called]) => called === url);
const bodyOf = (url: string) =>
  JSON.parse((callsTo(url)[0]?.[1] as RequestInit).body as string) as Record<string, unknown>;

describe('ProfilePage loading', () => {
  it('shows only a spinner while the session is read', () => {
    env.auth = { user: null, isAuthenticated: false, loading: true, loadUser: env.loadUser };
    render(<ProfilePage />);

    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('does not ask for the full profile of a visitor', () => {
    signIn(['local'], false);
    render(<ProfilePage />);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fills the personal data from the full profile, sending the token', async () => {
    signIn(['local']);
    render(<ProfilePage />);

    await waitFor(() => expect(screen.getByLabelText('Telefone')).toHaveValue('(00) 00000-0000'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/profile/full', {
      headers: { Authorization: 'Bearer jwt-1' },
    });
    expect(screen.getByLabelText('CPF')).toHaveValue('000.000.000-00');
    // the time part of the ISO instant is dropped
    expect(screen.getByLabelText('Data de Nascimento')).toHaveValue('1990-05-17');
    expect(screen.getByLabelText('Rua')).toHaveValue('Rua Exemplo, 1');
    expect(screen.getByLabelText('Cidade')).toHaveValue('Natal');
    expect(screen.getByLabelText('Estado')).toHaveValue('RN');
    expect(screen.getByLabelText('CEP')).toHaveValue('00000-000');
    expect(screen.getByRole('combobox', { name: 'Sexo' })).toHaveTextContent('Feminino');
  });

  it('leaves the fields empty for a profile with no personal data', async () => {
    signIn(['local']);
    answers['/api/auth/profile/full'] = { status: 200, body: {} };
    render(<ProfilePage />);

    await waitFor(() => expect(callsTo('/api/auth/profile/full')).toHaveLength(1));
    expect(screen.getByLabelText('Telefone')).toHaveValue('');
    expect(screen.getByLabelText('Data de Nascimento')).toHaveValue('');
    expect(screen.getByLabelText('Rua')).toHaveValue('');
  });

  it('reports the failure and keeps the form usable when the profile cannot be read', async () => {
    signIn(['local']);
    const failure = new TypeError('Failed to fetch');
    fetchMock.mockRejectedValue(failure);
    render(<ProfilePage />);

    await waitFor(() =>
      expect(env.report).toHaveBeenCalledWith(failure, { where: 'profile page' }),
    );
    expect(screen.getByLabelText('Telefone')).toBeEnabled();
  });

  it('has no accessibility violations', async () => {
    signIn(['local']);
    const { baseElement } = render(
      <main>
        <ProfilePage />
      </main>,
    );
    await waitFor(() => expect(callsTo('/api/auth/profile/full')).toHaveLength(1));

    expect(await axe(baseElement)).toHaveNoViolations();
  });
});

describe('ProfilePage account data', () => {
  it('sends the name and email and confirms', async () => {
    signIn(['local']);
    answers['/api/auth/profile'] = { status: 200 };
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.clear(screen.getByLabelText(/^Nome/));
    await user.type(screen.getByLabelText(/^Nome/), 'Ana Nova');
    await user.click(screen.getByRole('button', { name: 'Atualizar Perfil' }));

    expect(await screen.findByText(messages.profile.success.profile)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-1' },
      body: JSON.stringify({ name: 'Ana Nova', email: 'ana@exemplo.test' }),
    });
  });

  it('shows the catalogue message of the code when the update is refused', async () => {
    signIn(['local']);
    answers['/api/auth/profile'] = {
      status: 409,
      body: { code: 'EMAIL_ALREADY_REGISTERED', context: {} },
    };
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole('button', { name: 'Atualizar Perfil' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.errors.EMAIL_ALREADY_REGISTERED,
    );
    expect(screen.queryByText(messages.profile.success.profile)).not.toBeInTheDocument();
  });

  it('locks the email of a Google account and says why', () => {
    signIn(['google']);
    render(<ProfilePage />);

    expect(screen.getByLabelText(/^E-mail/)).toBeDisabled();
    expect(screen.getByText(messages.profile.profileInfo.emailLockedForGoogle)).toBeVisible();
  });
});

describe('ProfilePage personal data', () => {
  it('saves what was typed, leaving empty fields out', async () => {
    signIn(['local']);
    answers['/api/auth/profile/full'] = { status: 200, body: {} };
    answers['/api/auth/profile/complete'] = { status: 200 };
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.type(screen.getByLabelText('Telefone'), '(00) 90000-0000');
    await user.type(screen.getByLabelText('Cidade'), 'Natal');
    await user.click(screen.getByRole('button', { name: 'Salvar Dados Pessoais' }));

    expect(await screen.findByText(messages.profile.success.personalData)).toBeVisible();
    // JSON drops the undefined fields: nothing else is sent
    expect(bodyOf('/api/auth/profile/complete')).toEqual({
      phone: '(00) 90000-0000',
      address: { city: 'Natal' },
    });
  });

  it('sends the selected sex', async () => {
    signIn(['local']);
    answers['/api/auth/profile/full'] = { status: 200, body: {} };
    answers['/api/auth/profile/complete'] = { status: 200 };
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole('combobox', { name: 'Sexo' }));
    await user.click(await screen.findByRole('option', { name: 'Masculino' }));
    await user.click(screen.getByRole('button', { name: 'Salvar Dados Pessoais' }));

    await screen.findByText(messages.profile.success.personalData);
    expect(bodyOf('/api/auth/profile/complete')).toMatchObject({ sex: 'male' });
  });

  it('shows the catalogue message of the code when saving is refused', async () => {
    signIn(['local']);
    answers['/api/auth/profile/complete'] = {
      status: 400,
      body: { code: 'VALIDATION_FAILED', context: {} },
    };
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole('button', { name: 'Salvar Dados Pessoais' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.VALIDATION_FAILED);
  });
});

describe('ProfilePage change password (email and password account)', () => {
  async function fill(current: string, next: string, confirmation: string) {
    const user = userEvent.setup();
    render(<ProfilePage />);
    await user.type(screen.getByLabelText(/^Senha Atual/), current);
    await user.type(screen.getByLabelText(/^Nova Senha/), next);
    await user.type(screen.getByLabelText(/^Confirmar Nova Senha/), confirmation);
    await user.click(screen.getByRole('button', { name: 'Alterar Senha' }));
  }

  beforeEach(() => signIn(['local']));

  it('does not offer to set a password, the account has one', () => {
    render(<ProfilePage />);

    expect(screen.getByRole('heading', { name: 'Alterar Senha' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Definir Senha' })).not.toBeInTheDocument();
  });

  it('refuses two different passwords without calling the API', async () => {
    await fill('old-secret', 'new-secret-1', 'new-secret-2');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.profile.errors.passwordMismatch,
    );
    expect(callsTo('/api/auth/change-password')).toHaveLength(0);
  });

  it('refuses a password shorter than six characters without calling the API', async () => {
    await fill('old-secret', '12345', '12345');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.profile.errors.passwordTooShort,
    );
    expect(callsTo('/api/auth/change-password')).toHaveLength(0);
  });

  it('sends the current and the new password, confirms and clears the fields', async () => {
    answers['/api/auth/change-password'] = { status: 200 };
    await fill('old-secret', 'new-secret', 'new-secret');

    expect(await screen.findByText(messages.profile.success.passwordChanged)).toBeVisible();
    expect(bodyOf('/api/auth/change-password')).toEqual({
      currentPassword: 'old-secret',
      newPassword: 'new-secret',
    });
    expect(screen.getByLabelText(/^Senha Atual/)).toHaveValue('');
    expect(screen.getByLabelText(/^Nova Senha/)).toHaveValue('');
  });

  it('shows the catalogue message when the current password is wrong', async () => {
    answers['/api/auth/change-password'] = {
      status: 400,
      body: { code: 'CURRENT_PASSWORD_INCORRECT', context: {} },
    };
    await fill('wrong-secret', 'new-secret', 'new-secret');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.errors.CURRENT_PASSWORD_INCORRECT,
    );
  });
});

describe('ProfilePage set password (Google account)', () => {
  async function fill(next: string, confirmation: string) {
    const user = userEvent.setup();
    render(<ProfilePage />);
    await user.type(screen.getByLabelText(/^Nova Senha/), next);
    await user.type(screen.getByLabelText(/^Confirmar Nova Senha/), confirmation);
    await user.click(screen.getByRole('button', { name: 'Definir Senha' }));
  }

  beforeEach(() => signIn(['google']));

  it('offers to set a password instead of changing one', () => {
    render(<ProfilePage />);

    expect(screen.getByRole('heading', { name: 'Definir Senha' })).toBeVisible();
    expect(screen.queryByLabelText(/^Senha Atual/)).not.toBeInTheDocument();
  });

  it('refuses two different passwords without calling the API', async () => {
    await fill('new-secret-1', 'new-secret-2');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.profile.errors.passwordMismatch,
    );
    expect(callsTo('/api/auth/set-password')).toHaveLength(0);
  });

  it('refuses a password shorter than six characters without calling the API', async () => {
    await fill('12345', '12345');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.profile.errors.passwordTooShort,
    );
    expect(callsTo('/api/auth/set-password')).toHaveLength(0);
  });

  it('sets the password, confirms, clears the fields and reloads the account', async () => {
    answers['/api/auth/set-password'] = { status: 200 };
    env.loadUser.mockResolvedValue(undefined);
    await fill('new-secret', 'new-secret');

    expect(await screen.findByText(messages.profile.success.passwordSet)).toBeVisible();
    expect(bodyOf('/api/auth/set-password')).toEqual({ newPassword: 'new-secret' });
    expect(env.loadUser).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/^Nova Senha/)).toHaveValue('');
  });

  it('shows the catalogue message of the code when the account already has a password', async () => {
    answers['/api/auth/set-password'] = {
      status: 409,
      body: { code: 'PASSWORD_ALREADY_SET', context: {} },
    };
    await fill('new-secret', 'new-secret');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.errors.PASSWORD_ALREADY_SET,
    );
    expect(env.loadUser).not.toHaveBeenCalled();
  });
});
