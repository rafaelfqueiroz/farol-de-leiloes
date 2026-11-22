import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import ExportSection, { EXPORT_POLL_INTERVAL_MS, EXPORT_POLL_MAX_MS } from './ExportSection';
import { EXPIRED, FAILED, QUEUED, READY, json } from './privacy-test-support';

const env = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock('@/lib/report-client-error', () => ({ reportClientError: env.report }));

const fetchMock = vi.fn();
const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  vi.useRealTimers();
  fetchMock.mockReset();
  clicks.mockClear();
  env.report.mockReset();
  vi.unstubAllGlobals();
});

const urls = () => fetchMock.mock.calls.map(([url]) => String(url));

// TS-19, TS-20. BR-010-09, BR-010-11.
describe('ExportSection', () => {
  it.each(['light', 'dark'] as const)(
    'offers to ask for the file when there is none (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<ExportSection initial={null} />, { scheme });

      expect(screen.getByRole('heading', { level: 2, name: 'Exportar meus dados' })).toBeVisible();
      expect(container).toHaveTextContent('disponível por 7 dias e depois é apagado');
      expect(screen.getByRole('button', { name: 'Pedir exportação' })).toBeEnabled();
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it('asks for the export, shows "Preparando seu arquivo" and announces it in a status region', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(json(QUEUED, 202));
    renderWithProviders(<ExportSection initial={null} />);

    await user.click(screen.getByRole('button', { name: 'Pedir exportação' }));

    expect(await screen.findByText('Preparando seu arquivo', { selector: 'strong' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Preparando seu arquivo');
    expect(fetchMock.mock.calls[0]).toEqual([
      '/api/privacy/exports',
      expect.objectContaining({ method: 'POST' }),
    ]);
    expect(screen.queryByRole('button', { name: 'Pedir exportação' })).not.toBeInTheDocument();
  });

  it.each(['light', 'dark'] as const)(
    'shows a queued export with the day it was asked for, in Brasília time, and passes axe (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<ExportSection initial={QUEUED} />, { scheme });

      expect(container).toHaveTextContent(
        'Pedido em 19/11/2026 14:40 (horário de Brasília). Você pode sair desta página; o arquivo aparece aqui.',
      );
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  describe('while it is being prepared', () => {
    it('looks again every few seconds and shows the file as soon as it is ready, then stops', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(json({ items: [QUEUED] }))
        .mockResolvedValueOnce(json({ items: [READY] }));
      renderWithProviders(<ExportSection initial={QUEUED} />);

      expect(fetchMock).not.toHaveBeenCalled();
      await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_INTERVAL_MS));
      expect(urls()).toEqual(['/api/privacy/exports?page=1&pageSize=1']);
      expect(screen.getByText('Preparando seu arquivo', { selector: 'strong' })).toBeVisible();

      await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_INTERVAL_MS));
      expect(screen.getByText('Arquivo pronto', { selector: 'strong' })).toBeVisible();
      expect(screen.getByRole('status')).toHaveTextContent('Arquivo pronto');

      // nothing is read again once it is no longer queued
      await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_INTERVAL_MS * 10));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('shows a failure as soon as the export fails', async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValue(json({ items: [FAILED] }));
      renderWithProviders(<ExportSection initial={QUEUED} />);

      await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_INTERVAL_MS));

      expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível gerar o arquivo');
      await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_INTERVAL_MS * 3));
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('keeps looking through a failed look, and reports it', async () => {
      vi.useFakeTimers();
      const failure = new TypeError('Failed to fetch');
      fetchMock.mockRejectedValueOnce(failure).mockResolvedValueOnce(json({ items: [READY] }));
      renderWithProviders(<ExportSection initial={QUEUED} />);

      await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_INTERVAL_MS * 2));

      expect(env.report).toHaveBeenCalledWith(failure, { where: 'ExportSection poll' });
      expect(screen.getByText('Arquivo pronto', { selector: 'strong' })).toBeVisible();
    });

    it('keeps looking through an error answer and an answer that is not the contract', async () => {
      vi.useFakeTimers();
      fetchMock
        .mockResolvedValueOnce(json({ code: 'BACKEND_UNAVAILABLE', context: {} }, 502))
        .mockResolvedValueOnce(json({ unexpected: true }))
        .mockResolvedValueOnce(json({ items: [READY] }));
      renderWithProviders(<ExportSection initial={QUEUED} />);

      await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_INTERVAL_MS * 3));

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(screen.getByText('Arquivo pronto', { selector: 'strong' })).toBeVisible();
    });

    it('stops looking when the page goes away', async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValue(json({ items: [QUEUED] }));
      const { unmount } = renderWithProviders(<ExportSection initial={QUEUED} />);
      await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_INTERVAL_MS));
      expect(fetchMock).toHaveBeenCalledTimes(1);

      unmount();
      await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_INTERVAL_MS * 5));

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('gives up after a while, says it is slow, and keeps the export as queued', async () => {
      vi.useFakeTimers();
      fetchMock.mockResolvedValue(json({ items: [QUEUED] }));
      renderWithProviders(<ExportSection initial={QUEUED} />);

      await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_MAX_MS + EXPORT_POLL_INTERVAL_MS));

      expect(screen.getByText(/Está demorando mais que o normal/)).toBeVisible();
      const calls = fetchMock.mock.calls.length;
      await act(() => vi.advanceTimersByTimeAsync(EXPORT_POLL_INTERVAL_MS * 10));
      expect(fetchMock).toHaveBeenCalledTimes(calls);
      expect(screen.getByText('Preparando seu arquivo', { selector: 'strong' })).toBeVisible();
    });
  });

  describe('the file is ready', () => {
    it.each(['light', 'dark'] as const)(
      'says until when it is available and offers the download (%s)',
      async (scheme) => {
        const { container } = renderWithProviders(<ExportSection initial={READY} />, { scheme });

        expect(container).toHaveTextContent(
          'Disponível até 26/11/2026 14:45 (horário de Brasília).',
        );
        expect(screen.getByRole('button', { name: 'Baixar' })).toBeEnabled();
        expect(container).toHaveTextContent('O link de download vale 60 segundos');
        expect(await axe(container)).toHaveNoViolations();
      },
    );

    it('asks for the 60-second link and the BROWSER opens it, in a new tab, only when it is https', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(
        json({ url: 'https://files.example.test/x.json?sig=1', expiresInSeconds: 60 }),
      );
      renderWithProviders(<ExportSection initial={READY} />);

      await user.click(screen.getByRole('button', { name: 'Baixar' }));

      await waitFor(() => expect(clicks).toHaveBeenCalledTimes(1));
      expect(fetchMock.mock.calls[0]?.[0]).toBe(
        '/api/privacy/exports/64b7f0000000000000000e01/download',
      );
      const anchor = clicks.mock.contexts[0] as HTMLAnchorElement;
      expect(anchor.href).toBe('https://files.example.test/x.json?sig=1');
      expect(anchor.target).toBe('_blank');
      expect(anchor.rel).toContain('noopener');
      // the link is never kept in the page
      expect(document.body.innerHTML).not.toContain('sig=1');
    });

    it.each([
      ['an http link', 'http://files.example.test/x.json'],
      ['a javascript: link', 'javascript:alert(1)'],
      ['a data: link', 'data:text/plain,hi'],
      ['text that is no URL', 'not a url'],
      ['an empty link', ''],
    ])('does not open %s: it says the file could not be opened', async (_label, url) => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(json({ url, expiresInSeconds: 60 }));
      renderWithProviders(<ExportSection initial={READY} />);

      await user.click(screen.getByRole('button', { name: 'Baixar' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Não foi possível abrir o arquivo.',
      );
      expect(clicks).not.toHaveBeenCalled();
    });

    it('does not open an answer that is not the contract', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(json({ unexpected: true }));
      renderWithProviders(<ExportSection initial={READY} />);

      await user.click(screen.getByRole('button', { name: 'Baixar' }));

      expect(await screen.findByRole('alert')).toBeVisible();
      expect(clicks).not.toHaveBeenCalled();
    });

    it('locks the button while the link is being asked for', async () => {
      const user = userEvent.setup();
      let release: (response: Response) => void = () => undefined;
      fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
      renderWithProviders(<ExportSection initial={READY} />);

      await user.click(screen.getByRole('button', { name: 'Baixar' }));
      fireEvent.click(screen.getByRole('button', { name: 'Baixando' }));

      expect(screen.getByRole('button', { name: 'Baixando' })).toHaveAttribute('aria-busy', 'true');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      release(json({ url: 'https://files.example.test/x', expiresInSeconds: 60 }));
      await waitFor(() => expect(clicks).toHaveBeenCalled());
    });

    it("EXPORT_EXPIRED: says so, reads the account's exports again and shows the expired state", async () => {
      const user = userEvent.setup();
      fetchMock
        .mockResolvedValueOnce(json({ code: 'EXPORT_EXPIRED', context: {} }, 410))
        .mockResolvedValueOnce(json({ items: [EXPIRED] }));
      renderWithProviders(<ExportSection initial={READY} />);

      await user.click(screen.getByRole('button', { name: 'Baixar' }));

      expect(await screen.findByText('Arquivo expirado', { selector: 'strong' })).toBeVisible();
      expect(screen.getByRole('alert')).toHaveTextContent('Esta exportação expirou');
      expect(urls()[1]).toBe('/api/privacy/exports?page=1&pageSize=1');
    });

    it('another refusal is shown and leaves the file as it was', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(json({ code: 'TOO_MANY_REQUESTS', context: {} }, 429));
      renderWithProviders(<ExportSection initial={READY} />);

      await user.click(screen.getByRole('button', { name: 'Baixar' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Muitas solicitações em pouco tempo',
      );
      expect(screen.getByRole('button', { name: 'Baixar' })).toBeEnabled();
    });

    it('a network failure is reported and shown', async () => {
      const user = userEvent.setup();
      const failure = new TypeError('Failed to fetch');
      fetchMock.mockRejectedValue(failure);
      renderWithProviders(<ExportSection initial={READY} />);

      await user.click(screen.getByRole('button', { name: 'Baixar' }));

      expect(await screen.findByRole('alert')).toBeVisible();
      expect(env.report).toHaveBeenCalledWith(failure, { where: 'ExportSection download' });
    });
  });

  describe('failed and expired', () => {
    it.each(['light', 'dark'] as const)(
      'a failed export says so and offers to ask again (%s)',
      async (scheme) => {
        const { container } = renderWithProviders(<ExportSection initial={FAILED} />, { scheme });

        expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível gerar o arquivo');
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Tente pedir de novo. Se continuar, fale com o suporte.',
        );
        expect(screen.getByRole('button', { name: 'Pedir de novo' })).toBeEnabled();
        expect(await axe(container)).toHaveNoViolations();
      },
    );

    it.each(['light', 'dark'] as const)(
      'an expired export says until when it was available and offers a new one (%s)',
      async (scheme) => {
        const { container } = renderWithProviders(<ExportSection initial={EXPIRED} />, { scheme });

        expect(container).toHaveTextContent(
          'Ficou disponível até 26/11/2026 14:45 (horário de Brasília) e foi apagado.',
        );
        expect(screen.getByRole('button', { name: 'Pedir nova exportação' })).toBeEnabled();
        expect(await axe(container)).toHaveNoViolations();
      },
    );

    it('asking again from either state queues a new export', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(json({ ...QUEUED, id: '64b7f0000000000000000e02' }, 202));
      renderWithProviders(<ExportSection initial={FAILED} />);

      await user.click(screen.getByRole('button', { name: 'Pedir de novo' }));

      expect(
        await screen.findByText('Preparando seu arquivo', { selector: 'strong' }),
      ).toBeVisible();
    });

    it('treats a cancelled export (the account was closed) like having none', () => {
      renderWithProviders(<ExportSection initial={{ ...QUEUED, status: 'cancelled' }} />);

      expect(screen.getByRole('button', { name: 'Pedir exportação' })).toBeVisible();
    });
  });

  describe('asking for an export', () => {
    it('shows the refusal and keeps the button', async () => {
      const user = userEvent.setup();
      fetchMock.mockResolvedValue(json({ code: 'TOO_MANY_REQUESTS', context: {} }, 429));
      renderWithProviders(<ExportSection initial={null} />);

      await user.click(screen.getByRole('button', { name: 'Pedir exportação' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        'Muitas solicitações em pouco tempo',
      );
      expect(screen.getByRole('button', { name: 'Pedir exportação' })).toBeEnabled();
    });

    it('reports a network failure and shows it', async () => {
      const user = userEvent.setup();
      const failure = new TypeError('Failed to fetch');
      fetchMock.mockRejectedValue(failure);
      renderWithProviders(<ExportSection initial={null} />);

      await user.click(screen.getByRole('button', { name: 'Pedir exportação' }));

      expect(await screen.findByRole('alert')).toBeVisible();
      expect(env.report).toHaveBeenCalledWith(failure, { where: 'ExportSection request' });
    });

    it('sends one request when the button is pressed twice', async () => {
      const user = userEvent.setup();
      let release: (response: Response) => void = () => undefined;
      fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
      renderWithProviders(<ExportSection initial={null} />);

      await user.click(screen.getByRole('button', { name: 'Pedir exportação' }));
      fireEvent.click(screen.getByRole('button', { name: 'Pedindo' }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      release(json(QUEUED, 202));
      await screen.findByText('Preparando seu arquivo', { selector: 'strong' });
    });
  });
});
