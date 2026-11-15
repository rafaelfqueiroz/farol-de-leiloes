import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import messages from '@/messages/pt-BR.json';
import { axe, renderWithProviders as render } from '@/test/render';
import SupportPage from './SupportPage';

// SPEC-014: the FAQ and the support request form. AR-38/AR-39: a refusal shows the catalogue text.
const fetchMock = vi.fn();

beforeEach(() => {
  window.localStorage.setItem('token', 'jwt-1');
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

const answer = (status: number, body: unknown = {}) =>
  fetchMock.mockResolvedValue({ ok: status < 400, status, json: async () => body });

async function fillForm(
  title = 'Erro ao favoritar',
  body = 'Não consigo favoritar nenhum imóvel.',
) {
  const user = userEvent.setup();
  render(<SupportPage />);
  await user.type(screen.getByLabelText(/^Título/), title);
  await user.type(screen.getByLabelText(/^Descrição/), body);
  return user;
}

describe('SupportPage', () => {
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

  // Known defect, reported for its own issue (DV-23): the page title is an <h4> and the section
  // titles are <h6>, so axe's heading-order fails (DS-21). Delete `.fails` when it is fixed.
  it.fails('has no accessibility violations', async () => {
    const { baseElement } = render(
      <main>
        <SupportPage />
      </main>,
    );

    expect(await axe(baseElement)).toHaveNoViolations();
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

    await user.type(screen.getByLabelText(/^Título/), 'Erro ao favoritar');
    expect(submit).toBeDisabled();
    await user.type(screen.getByLabelText(/^Descrição/), 'Não consigo favoritar nenhum imóvel.');

    expect(submit).toBeEnabled();
  });

  it('keeps Send disabled for fields that are only spaces', async () => {
    const user = userEvent.setup();
    render(<SupportPage />);

    await user.type(screen.getByLabelText(/^Título/), '   ');
    await user.type(screen.getByLabelText(/^Descrição/), '          ');

    expect(screen.getByRole('button', { name: 'Enviar solicitação' })).toBeDisabled();
  });

  it('sends the request with the token, confirms and clears the form', async () => {
    answer(201);
    const user = await fillForm();

    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));

    expect(await screen.findByText(messages.support.form.success)).toBeVisible();
    expect(fetchMock).toHaveBeenCalledWith('/api/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer jwt-1' },
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

  it('says the session expired, without calling the API, when there is no token', async () => {
    window.localStorage.clear();
    const user = await fillForm();

    await user.click(screen.getByRole('button', { name: 'Enviar solicitação' }));

    expect(await screen.findByText(messages.errors.UNAUTHENTICATED)).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
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
