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
  title = 'Erro ao favoritar',
  body = 'Não consigo favoritar nenhum imóvel.',
) {
  const user = userEvent.setup();
  render(<SupportPage />);
  await enter(user, screen.getByLabelText(/^Título/), title);
  await enter(user, screen.getByLabelText(/^Descrição/), body);
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

    await enter(user, screen.getByLabelText(/^Título/), 'Erro ao favoritar');
    expect(submit).toBeDisabled();
    await enter(user, screen.getByLabelText(/^Descrição/), 'Não consigo favoritar nenhum imóvel.');

    expect(submit).toBeEnabled();
  });

  it('keeps Send disabled for fields that are only spaces', async () => {
    const user = userEvent.setup();
    render(<SupportPage />);

    await enter(user, screen.getByLabelText(/^Título/), '   ');
    await enter(user, screen.getByLabelText(/^Descrição/), '          ');

    expect(screen.getByRole('button', { name: 'Enviar solicitação' })).toBeDisabled();
  });

  it('sends the request with the session cookie, confirms and clears the form', async () => {
    answer(201);
    const user = await fillForm();

    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));

    expect(await screen.findByText(messages.support.form.success)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/support', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Erro ao favoritar',
        description: 'Não consigo favoritar nenhum imóvel.',
      }),
    });
    expect(screen.getByLabelText(/^Título/)).toHaveValue('');
    expect(screen.getByLabelText(/^Descrição/)).toHaveValue('');
  });

  it('shows the catalogue message of the code and keeps the text when the API refuses', async () => {
    answer(400, { code: 'VALIDATION_FAILED', context: {} });
    const user = await fillForm();

    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));

    expect(await screen.findByText(messages.errors.VALIDATION_FAILED)).toBeVisible();
    expect(screen.getByLabelText(/^Título/)).toHaveValue('Erro ao favoritar');
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
