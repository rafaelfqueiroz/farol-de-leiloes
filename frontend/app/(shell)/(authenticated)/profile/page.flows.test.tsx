import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import ProfilePage from './page';

// SPEC-001: the profile page (frame 3). What it shows from GET /auth/profile/full, what each of
// its two forms sends, and how a refusal is told (AR-38/AR-39). TS-27: every person below is made up.
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

// what a stored legacy account still answers: the page must ignore the four legacy fields
const fullProfile = { phone: '+5584999991234' };

function signIn(providers: string[], { authenticated = true, emailVerified = true } = {}) {
  const user = {
    _id: 'u1',
    name: 'Ana Teste',
    email: 'ana@exemplo.test',
    providers,
    emailVerified,
  };
  env.auth = { user, isAuthenticated: authenticated, loading: false, loadUser: env.loadUser };
}

beforeEach(() => {
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
    signIn(['local'], { authenticated: false });
    render(<ProfilePage />);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fills the phone from the full profile and offers nothing about CPF, birth date, sex or address', async () => {
    signIn(['local']);
    render(<ProfilePage />);

    await waitFor(() => expect(screen.getByLabelText('Telefone')).toHaveValue('(84) 99999-1234'));
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/profile/full', {
      credentials: 'same-origin',
    });
    for (const legacy of ['CPF', /nascimento/i, 'Sexo', 'Rua', 'Cidade', 'Estado', 'CEP']) {
      expect(screen.queryByLabelText(legacy)).not.toBeInTheDocument();
    }
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

describe('ProfilePage account data (frames 3.1 to 3.3)', () => {
  it('shows the e-mail read-only with its helper, for a password account', () => {
    signIn(['local']);
    render(<ProfilePage />);

    const email = screen.getByLabelText(/^E-mail/);
    expect(email).toBeDisabled();
    expect(email).toHaveAccessibleDescription('O e-mail é o seu acesso e não pode ser alterado');
    expect(screen.queryByText('Não confirmado')).not.toBeInTheDocument();
  });

  it('shows the same read-only e-mail for a Google account', () => {
    signIn(['google']);
    render(<ProfilePage />);

    expect(screen.getByLabelText(/^E-mail/)).toBeDisabled();
    expect(screen.getByText('O e-mail é o seu acesso e não pode ser alterado')).toBeVisible();
  });

  it('frame 3.3: an unconfirmed account gets the "Não confirmado" pill under the e-mail', () => {
    signIn(['local'], { emailVerified: false });
    render(<ProfilePage />);

    expect(screen.getByText('Não confirmado')).toBeVisible();
  });

  it('sends name and phone as typed, never the e-mail, then confirms with the toast', async () => {
    signIn(['local']);
    answers['/api/auth/profile'] = { status: 200 };
    env.loadUser.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ProfilePage />);
    await waitFor(() => expect(screen.getByLabelText('Telefone')).toHaveValue('(84) 99999-1234'));

    await user.clear(screen.getByLabelText(/^Nome/));
    await user.type(screen.getByLabelText(/^Nome/), 'Ana Nova');
    await user.clear(screen.getByLabelText('Telefone'));
    await user.type(screen.getByLabelText('Telefone'), '(84) 99999-1234');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText('Perfil salvo')).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/profile', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ana Nova', phone: '(84) 99999-1234' }),
    });
    expect(bodyOf('/api/auth/profile')).not.toHaveProperty('email');
    expect(env.loadUser).toHaveBeenCalled();
  });

  it('shows a stored landline formatted, and saving it untouched sends it as shown', async () => {
    signIn(['local']);
    answers['/api/auth/profile/full'] = { status: 200, body: { phone: '+558432221234' } };
    answers['/api/auth/profile'] = { status: 200 };
    env.loadUser.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ProfilePage />);
    await waitFor(() => expect(screen.getByLabelText('Telefone')).toHaveValue('(84) 3222-1234'));

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await screen.findByText('Perfil salvo');
    // the API normalises it back to the number it already holds
    expect(bodyOf('/api/auth/profile')).toEqual({ name: 'Ana Teste', phone: '(84) 3222-1234' });
  });

  it('keeps a stored value it cannot read as a Brazilian number as it is', async () => {
    signIn(['local']);
    answers['/api/auth/profile/full'] = { status: 200, body: { phone: '+14155552671' } };
    render(<ProfilePage />);

    await waitFor(() => expect(screen.getByLabelText('Telefone')).toHaveValue('+14155552671'));
  });

  it('frame 3.2: a refused phone is told under the field, with its hint replaced', async () => {
    signIn(['local']);
    answers['/api/auth/profile'] = {
      status: 400,
      body: { code: 'VALIDATION_FAILED', context: { fields: ['phone'] } },
    };
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.type(screen.getByLabelText('Telefone'), '9999');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() =>
      expect(screen.getByLabelText('Telefone')).toHaveAccessibleDescription(
        'Informe o telefone com DDD',
      ),
    );
    expect(screen.queryByText('Perfil salvo')).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows the hint under the phone before anything is refused', () => {
    signIn(['local']);
    render(<ProfilePage />);

    expect(screen.getByLabelText('Telefone')).toHaveAccessibleDescription(
      'Com DDD, ex.: (84) 99999-1234',
    );
  });

  it('shows the catalogue message of any other refusal in an alert', async () => {
    signIn(['local']);
    answers['/api/auth/profile'] = {
      status: 400,
      body: { code: 'VALIDATION_FAILED', context: { fields: ['name'] } },
    };
    const user = userEvent.setup();
    render(<ProfilePage />);

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.VALIDATION_FAILED);
  });
});

describe('ProfilePage change password (email and password account)', () => {
  async function fill(current: string, next: string) {
    const user = userEvent.setup();
    render(<ProfilePage />);
    await user.type(screen.getByLabelText(/^Senha atual/), current);
    await user.type(screen.getByLabelText(/^Nova senha/), next);
    await user.click(screen.getByRole('button', { name: 'Alterar senha' }));
  }

  beforeEach(() => signIn(['local']));

  it('asks for the current password, hints 8 to 128 and warns about the other devices', () => {
    render(<ProfilePage />);

    expect(screen.getByRole('heading', { level: 2, name: 'Senha' })).toBeVisible();
    expect(screen.getByLabelText(/^Nova senha/)).toHaveAccessibleDescription(
      'De 8 a 128 caracteres',
    );
    expect(screen.getByLabelText(/^Nova senha/)).toHaveAttribute('maxlength', '128');
    expect(screen.getByText('Ao alterar a senha, você sai dos outros dispositivos.')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Criar senha' })).not.toBeInTheDocument();
  });

  it('refuses a password shorter than eight characters without calling the API', async () => {
    await fill('old-secret', '1234567');

    await waitFor(() =>
      expect(screen.getByLabelText(/^Nova senha/)).toHaveAccessibleDescription(
        'Use de 8 a 128 caracteres',
      ),
    );
    expect(callsTo('/api/auth/change-password')).toHaveLength(0);
  });

  it('sends the current and the new password, confirms and clears the fields', async () => {
    answers['/api/auth/change-password'] = { status: 200 };
    await fill('old-secret', 'new-secret');

    expect(await screen.findByText('Senha alterada')).toBeVisible();
    expect(bodyOf('/api/auth/change-password')).toEqual({
      currentPassword: 'old-secret',
      newPassword: 'new-secret',
    });
    expect(screen.getByLabelText(/^Senha atual/)).toHaveValue('');
    expect(screen.getByLabelText(/^Nova senha/)).toHaveValue('');
  });

  it('shows the catalogue message when the current password is wrong', async () => {
    answers['/api/auth/change-password'] = {
      status: 400,
      body: { code: 'CURRENT_PASSWORD_INCORRECT', context: {} },
    };
    await fill('wrong-secret', 'new-secret');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.errors.CURRENT_PASSWORD_INCORRECT,
    );
  });
});

describe('ProfilePage create password (Google account, frame 3.4)', () => {
  async function fill(next: string) {
    const user = userEvent.setup();
    render(<ProfilePage />);
    await user.type(screen.getByLabelText(/^Nova senha/), next);
    await user.click(screen.getByRole('button', { name: 'Criar senha' }));
  }

  beforeEach(() => signIn(['google']));

  it('offers to create a password, without the current-password field', () => {
    render(<ProfilePage />);

    expect(
      screen.getByText(
        'Você entrou com o Google. Crie uma senha para também entrar com e-mail e senha.',
      ),
    ).toBeVisible();
    expect(screen.getByText('Ao criar a senha, você sai dos outros dispositivos.')).toBeVisible();
    expect(screen.queryByLabelText(/^Senha atual/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Alterar senha' })).not.toBeInTheDocument();
  });

  it('refuses a password shorter than eight characters without calling the API', async () => {
    await fill('1234567');

    await waitFor(() =>
      expect(screen.getByLabelText(/^Nova senha/)).toHaveAccessibleDescription(
        'Use de 8 a 128 caracteres',
      ),
    );
    expect(callsTo('/api/auth/set-password')).toHaveLength(0);
  });

  it('creates the password, confirms, clears the field and reloads the account', async () => {
    answers['/api/auth/set-password'] = { status: 200 };
    env.loadUser.mockResolvedValue(undefined);
    await fill('new-secret');

    expect(await screen.findByText('Senha criada')).toBeVisible();
    expect(bodyOf('/api/auth/set-password')).toEqual({ newPassword: 'new-secret' });
    expect(env.loadUser).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/^Nova senha/)).toHaveValue('');
  });

  it('shows the catalogue message of the code when the account already has a password', async () => {
    answers['/api/auth/set-password'] = {
      status: 409,
      body: { code: 'PASSWORD_ALREADY_SET', context: {} },
    };
    await fill('new-secret');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      messages.errors.PASSWORD_ALREADY_SET,
    );
    expect(env.loadUser).not.toHaveBeenCalled();
  });
});
