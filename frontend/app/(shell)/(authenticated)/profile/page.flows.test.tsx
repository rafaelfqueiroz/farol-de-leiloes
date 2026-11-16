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
// an answer may be a promise, so a test can hold a request pending and release it later
let answers: Record<string, Answer | Promise<Answer>>;

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
    const pending = answers[url];
    if (!pending) throw new Error(`unexpected request ${url}`);
    const answer = await pending;
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

// a request that stays pending until the test releases it
function deferred() {
  let release!: (answer: Answer) => void;
  const promise = new Promise<Answer>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

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
  it('shows the e-mail read-only with its helper, for a password account', async () => {
    signIn(['local']);
    render(<ProfilePage />);

    const email = await screen.findByLabelText(/^E-mail/);
    expect(email).toBeDisabled();
    expect(email).toHaveAccessibleDescription('O e-mail é o seu acesso e não pode ser alterado');
    expect(screen.queryByText('Não confirmado')).not.toBeInTheDocument();
  });

  it('shows the same read-only e-mail for a Google account', async () => {
    signIn(['google']);
    render(<ProfilePage />);

    expect(await screen.findByLabelText(/^E-mail/)).toBeDisabled();
    expect(screen.getByText('O e-mail é o seu acesso e não pode ser alterado')).toBeVisible();
  });

  it('frame 3.3: an unconfirmed account gets the "Não confirmado" pill under the e-mail', async () => {
    signIn(['local'], { emailVerified: false });
    render(<ProfilePage />);

    expect(await screen.findByText('Não confirmado')).toBeVisible();
  });

  it('sends the name, never the e-mail, then confirms with the toast', async () => {
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
    // the phone was retyped to the number already stored, so it is not part of the change
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/profile', {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Ana Nova' }),
    });
    expect(bodyOf('/api/auth/profile')).not.toHaveProperty('email');
    expect(env.loadUser).toHaveBeenCalled();
  });

  it('shows a stored landline formatted, and saving the name leaves it out of the request', async () => {
    signIn(['local']);
    answers['/api/auth/profile/full'] = { status: 200, body: { phone: '+558432221234' } };
    answers['/api/auth/profile'] = { status: 200 };
    env.loadUser.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ProfilePage />);
    await waitFor(() => expect(screen.getByLabelText('Telefone')).toHaveValue('(84) 3222-1234'));

    await user.click(screen.getByRole('button', { name: 'Salvar' }));

    await screen.findByText('Perfil salvo');
    expect(bodyOf('/api/auth/profile')).toEqual({ name: 'Ana Teste' });
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

    await screen.findByLabelText('Telefone');
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

  it('shows the hint under the phone before anything is refused', async () => {
    signIn(['local']);
    render(<ProfilePage />);

    expect(await screen.findByLabelText('Telefone')).toHaveAccessibleDescription(
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

    await user.click(await screen.findByRole('button', { name: 'Salvar' }));

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

// Review finding (P2): the PATCH must never unset a stored phone the page has not read. BR-001-25:
// the page sends only `{ name?, phone? }`, never the e-mail; the phone goes only once it loaded
// (and then only when the person changed it) and an emptied phone is the removal (BR-001-27).
describe('ProfilePage reads the stored phone before it can save (DS-19)', () => {
  const storedAsShown = '(84) 99999-1234';

  async function readyForm() {
    signIn(['local']);
    answers['/api/auth/profile'] = { status: 200 };
    env.loadUser.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<ProfilePage />);
    await waitFor(() => expect(screen.getByLabelText('Telefone')).toHaveValue(storedAsShown));
    return user;
  }

  async function renameAndSave(user: ReturnType<typeof userEvent.setup>) {
    await user.clear(screen.getByLabelText(/^Nome/));
    await user.type(screen.getByLabelText(/^Nome/), 'Ana Nova');
    await user.click(screen.getByRole('button', { name: 'Salvar' }));
    await screen.findByText('Perfil salvo');
  }

  describe('while the read is pending', () => {
    it('shows the loading state with no way to submit, then the stored phone, and saving the name omits the phone', async () => {
      signIn(['local']);
      const read = deferred();
      answers['/api/auth/profile/full'] = read.promise;
      answers['/api/auth/profile'] = { status: 200 };
      env.loadUser.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<ProfilePage />);

      expect(screen.getByRole('status', { name: 'Carregando…' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Telefone')).not.toBeInTheDocument();
      expect(callsTo('/api/auth/profile')).toHaveLength(0);

      read.release({ status: 200, body: fullProfile });
      await waitFor(() => expect(screen.getByLabelText('Telefone')).toHaveValue(storedAsShown));
      expect(screen.queryByRole('status', { name: 'Carregando…' })).not.toBeInTheDocument();

      await renameAndSave(user);
      expect(callsTo('/api/auth/profile')).toHaveLength(1);
      expect(bodyOf('/api/auth/profile')).toEqual({ name: 'Ana Nova' });
    });

    it('keeps the password card usable', () => {
      signIn(['local']);
      answers['/api/auth/profile/full'] = deferred().promise;
      render(<ProfilePage />);

      expect(screen.getByLabelText(/^Nova senha/)).toBeEnabled();
      expect(screen.getByRole('button', { name: 'Alterar senha' })).toBeEnabled();
    });

    it('has no accessibility violations', async () => {
      signIn(['local']);
      answers['/api/auth/profile/full'] = deferred().promise;
      const { baseElement } = render(
        <main>
          <ProfilePage />
        </main>,
      );

      expect(await axe(baseElement)).toHaveNoViolations();
    });
  });

  describe('when the read failed', () => {
    it('shows the error state with the catalogue message, no way to save, and a retry that makes the page usable', async () => {
      signIn(['local']);
      answers['/api/auth/profile/full'] = {
        status: 500,
        body: { code: 'INTERNAL_ERROR', context: {} },
      };
      answers['/api/auth/profile'] = { status: 200 };
      env.loadUser.mockResolvedValue(undefined);
      const user = userEvent.setup();
      render(<ProfilePage />);

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(messages.errors.INTERNAL_ERROR);
      expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Telefone')).not.toBeInTheDocument();
      expect(callsTo('/api/auth/profile')).toHaveLength(0);
      expect(screen.getByLabelText(/^Nova senha/)).toBeEnabled();

      answers['/api/auth/profile/full'] = { status: 200, body: fullProfile };
      await user.click(screen.getByRole('button', { name: 'Tentar novamente' }));

      await waitFor(() => expect(screen.getByLabelText('Telefone')).toHaveValue(storedAsShown));
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      await renameAndSave(user);
      expect(bodyOf('/api/auth/profile')).toEqual({ name: 'Ana Nova' });
    });

    it('tells a network failure with the catalogue fallback and reports it', async () => {
      signIn(['local']);
      const failure = new TypeError('Failed to fetch');
      fetchMock.mockRejectedValue(failure);
      render(<ProfilePage />);

      expect(await screen.findByRole('alert')).toHaveTextContent(messages.errors.UNKNOWN);
      expect(env.report).toHaveBeenCalledWith(failure, { where: 'profile page' });
      expect(screen.queryByRole('button', { name: 'Salvar' })).not.toBeInTheDocument();
    });

    it('has no accessibility violations', async () => {
      signIn(['local']);
      answers['/api/auth/profile/full'] = {
        status: 500,
        body: { code: 'INTERNAL_ERROR', context: {} },
      };
      const { baseElement } = render(
        <main>
          <ProfilePage />
        </main>,
      );
      await screen.findByRole('alert');

      expect(await axe(baseElement)).toHaveNoViolations();
    });
  });

  describe('what the PATCH carries once the phone is read', () => {
    it('never unsets the stored phone when only the name is saved', async () => {
      const user = await readyForm();

      await renameAndSave(user);

      expect(bodyOf('/api/auth/profile')).toEqual({ name: 'Ana Nova' });
      expect(bodyOf('/api/auth/profile')).not.toHaveProperty('phone');
    });

    it('sends the removal (an empty string) when the person empties the phone', async () => {
      const user = await readyForm();

      await user.clear(screen.getByLabelText('Telefone'));
      await user.click(screen.getByRole('button', { name: 'Salvar' }));
      await screen.findByText('Perfil salvo');

      expect(bodyOf('/api/auth/profile')).toEqual({ name: 'Ana Teste', phone: '' });
    });

    it('sends the phone as typed and never the e-mail', async () => {
      const user = await readyForm();

      await user.clear(screen.getByLabelText('Telefone'));
      await user.type(screen.getByLabelText('Telefone'), '84 98888-7777');
      await renameAndSave(user);

      expect(bodyOf('/api/auth/profile')).toEqual({ name: 'Ana Nova', phone: '84 98888-7777' });
      expect(bodyOf('/api/auth/profile')).not.toHaveProperty('email');
    });

    it('treats the saved phone as the new stored one: a second save omits it', async () => {
      const user = await readyForm();
      await user.clear(screen.getByLabelText('Telefone'));
      await user.type(screen.getByLabelText('Telefone'), '84 98888-7777');
      await user.click(screen.getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(callsTo('/api/auth/profile')).toHaveLength(1));
      await waitFor(() => expect(screen.getByRole('button', { name: 'Salvar' })).toBeEnabled());

      await user.click(screen.getByRole('button', { name: 'Salvar' }));
      await waitFor(() => expect(callsTo('/api/auth/profile')).toHaveLength(2));

      const second = JSON.parse(
        (callsTo('/api/auth/profile')[1]?.[1] as RequestInit).body as string,
      ) as Record<string, unknown>;
      expect(second).toEqual({ name: 'Ana Teste' });
    });
  });
});
