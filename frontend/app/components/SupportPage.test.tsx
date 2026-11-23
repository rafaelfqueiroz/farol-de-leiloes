import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import SupportPage from './SupportPage';

// SPEC-014: the FAQ and the support request form. AR-38/AR-39: a refusal shows the catalogue text.
const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

const answer = (status: number, body: unknown = {}) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

// One paste instead of a keystroke per character: MUI re-renders on every key, and typing ~50
// characters took longer than the 5 s test timeout on a loaded CI runner.
async function enter(user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) {
  await user.click(field);
  await user.paste(text);
}

async function fillForm(
  subject = 'Erro ao favoritar',
  message = 'Não consigo favoritar nenhum imóvel.',
) {
  const user = userEvent.setup();
  render(<SupportPage />);
  await enter(user, screen.getByLabelText(/^Assunto/), subject);
  await enter(user, screen.getByLabelText(/^Mensagem/), message);
  return user;
}

describe('SupportPage', () => {
  it('has one h1 with the FAQ and the form as h2 sections (DS-15)', () => {
    render(<SupportPage />);

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Suporte' })).toBeInTheDocument();
    expect(
      screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent),
    ).toEqual(['Perguntas frequentes', 'Enviar solicitação']);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('lists the FAQ questions as accordions and keeps the submit disabled while empty', () => {
    render(<SupportPage />);

    expect(screen.getAllByRole('button', { expanded: false }).length).toBeGreaterThanOrEqual(6);
    expect(screen.getByRole('button', { name: /enviar solicitação/i })).toBeDisabled();
  });

  it.each(['light', 'dark'] as const)('has no accessibility violations in %s', async (scheme) => {
    // the AppShell owns <main> (#42), so the landmark is supplied here
    const { baseElement } = render(
      <main>
        <SupportPage />
      </main>,
      { scheme },
    );
    expect(await axe(baseElement)).toHaveNoViolations();
  });

  it('lists the frequently asked questions, collapsed', () => {
    render(<SupportPage />);

    expect(screen.getByRole('heading', { name: 'Suporte' })).toBeVisible();
    for (const faq of Object.values(messages.support.faq)) {
      expect(screen.getByRole('button', { name: faq.question })).toHaveAttribute(
        'aria-expanded',
        'false',
      );
    }
  });

  it('expands a question to show its answer', async () => {
    const user = userEvent.setup();
    render(<SupportPage />);
    const question = screen.getByRole('button', {
      name: messages.support.faq.cancel.question,
    });

    await user.click(question);

    expect(question).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(messages.support.faq.cancel.answer)).toBeVisible();
  });

  it('keeps Send disabled until both fields have text', async () => {
    const user = userEvent.setup();
    render(<SupportPage />);
    const submit = screen.getByRole('button', { name: 'Enviar solicitação' });
    expect(submit).toBeDisabled();

    await enter(user, screen.getByLabelText(/^Assunto/), 'Erro ao favoritar');
    expect(submit).toBeDisabled();
    await enter(user, screen.getByLabelText(/^Mensagem/), 'Não consigo favoritar nenhum imóvel.');

    expect(submit).toBeEnabled();
  });

  it('keeps Send disabled for fields that are only spaces', async () => {
    const user = userEvent.setup();
    render(<SupportPage />);

    await enter(user, screen.getByLabelText(/^Assunto/), '   ');
    await enter(user, screen.getByLabelText(/^Mensagem/), '          ');

    expect(screen.getByRole('button', { name: 'Enviar solicitação' })).toBeDisabled();
  });

  it('SPEC-009 BR-009-06, BR-009-08: sends subject and message with the permission off, shows the protocol and clears the form', async () => {
    answer(201, { id: '64b7f00000000000000a0001', protocol: 'FL-2026-000042' });
    const user = await fillForm();

    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));

    expect(await screen.findByText(/Seu protocolo é FL-2026-000042\./)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/support', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: 'Erro ao favoritar',
        message: 'Não consigo favoritar nenhum imóvel.',
        allowDataAccess: false,
      }),
    });
    expect(screen.getByLabelText(/^Assunto/)).toHaveValue('');
    expect(screen.getByLabelText(/^Mensagem/)).toHaveValue('');
  });

  it('BR-009-05: limits the subject to 200 characters and the message to 5,000', () => {
    render(<SupportPage />);

    expect(screen.getByLabelText(/^Assunto/)).toHaveAttribute('maxlength', '200');
    expect(screen.getByLabelText(/^Mensagem/)).toHaveAttribute('maxlength', '5000');
  });

  it('shows the catalogue message of the code and keeps the text when the API refuses', async () => {
    answer(400, { code: 'VALIDATION_FAILED', context: {} });
    const user = await fillForm();

    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));

    expect(await screen.findByText(messages.errors.VALIDATION_FAILED)).toBeVisible();
    expect(screen.getByLabelText(/^Assunto/)).toHaveValue('Erro ao favoritar');
  });

  it('says the session expired when the API answers that nobody is signed in', async () => {
    answer(401, { code: 'UNAUTHENTICATED', context: {} });
    const user = await fillForm();

    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));

    expect(await screen.findByText(messages.errors.UNAUTHENTICATED)).toBeVisible();
  });

  it('shows the generic message when the API cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const user = await fillForm();

    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));

    expect(await screen.findByText(messages.errors.UNKNOWN)).toBeVisible();
  });

  it('disables Send while the request is on its way', async () => {
    let finish: (value: unknown) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    const user = await fillForm();

    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));

    expect(screen.getByRole('button', { name: 'Enviando…' })).toBeDisabled();
    finish({ ok: true, status: 201, json: async () => ({}) });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Enviando…' })).not.toBeInTheDocument(),
    );
  });
});
