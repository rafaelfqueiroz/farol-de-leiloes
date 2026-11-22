import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe, renderWithProviders } from '@/test/render';
import type { WhatsappConsent } from './privacy-api';
import { WHATSAPP_OFF, WHATSAPP_ON, json } from './privacy-test-support';
import WhatsappSection from './WhatsappSection';

vi.mock('@/lib/report-client-error', () => ({ reportClientError: vi.fn() }));

const fetchMock = vi.fn();
beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function Host({
  initial,
  onChange,
}: {
  initial: WhatsappConsent;
  onChange?: (c: WhatsappConsent) => void;
}) {
  const [consent, setConsent] = useState(initial);
  return (
    <WhatsappSection
      consent={consent}
      onChange={(next) => {
        onChange?.(next);
        setConsent(next);
      }}
    />
  );
}

const SWITCH = 'Receber avisos por WhatsApp';

// TS-19, TS-20. BR-010-27: its own consent, apart from the terms, withdrawable at any time.
describe('WhatsappSection', () => {
  it.each(['light', 'dark'] as const)(
    'shows the consent as given, with when and which text (%s)',
    async (scheme) => {
      const { container } = renderWithProviders(<Host initial={WHATSAPP_ON} />, { scheme });

      expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked();
      expect(screen.getByText('Consentimento ativo')).toBeVisible();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Dado em 02/11/2026 09:10 (horário de Brasília), texto versão 1.',
      );
      expect(container).toHaveTextContent('Ter consentido não liga nenhum aviso');
      expect(await axe(container)).toHaveNoViolations();
    },
  );

  it.each([
    [
      'withdrawn',
      WHATSAPP_OFF,
      'Cancelado em 18/11/2026 17:45 (horário de Brasília). Nenhuma mensagem é enviada.',
    ],
    [
      'declined',
      { state: 'declined', at: '2026-11-18T20:45:00.000Z', textVersion: '1' } as const,
      'Recusado em 18/11/2026 17:45 (horário de Brasília). Nenhuma mensagem é enviada.',
    ],
    [
      'never answered',
      { state: 'none', at: null, textVersion: null } as const,
      'Você ainda não deu este consentimento. Nenhuma mensagem é enviada.',
    ],
  ])('shows "%s" as no consent, with the state line', async (_label, consent, line) => {
    const { container } = renderWithProviders(<Host initial={consent} />);

    expect(screen.getByRole('switch', { name: SWITCH })).not.toBeChecked();
    expect(screen.getByText('Sem consentimento')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent(line);
    expect(await axe(container)).toHaveNoViolations();
  });

  it('withdraws at once from the privacy page and shows the state the API answers', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(json(WHATSAPP_OFF));
    const onChange = vi.fn();
    renderWithProviders(<Host initial={WHATSAPP_ON} onChange={onChange} />);

    await user.click(screen.getByRole('switch', { name: SWITCH }));

    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).not.toBeChecked());
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/privacy/whatsapp-consent');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'withdrawn', method: 'privacy_page' });
    expect(onChange).toHaveBeenCalledWith(WHATSAPP_OFF);
    expect(screen.getByRole('status')).toHaveTextContent('Cancelado em 18/11/2026 17:45');
  });

  it('grants again, from the privacy page, which records the text in force', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      json({ state: 'granted', at: '2026-11-20T15:00:00.000Z', textVersion: '1' }),
    );
    renderWithProviders(<Host initial={WHATSAPP_OFF} />);

    await user.click(screen.getByRole('switch', { name: SWITCH }));

    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked());
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1].body))).toEqual({
      action: 'granted',
      method: 'privacy_page',
    });
  });

  it('keeps the switch where it was and says why when the API refuses', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(json({ code: 'TOO_MANY_REQUESTS', context: {} }, 429));
    renderWithProviders(<Host initial={WHATSAPP_ON} />);

    await user.click(screen.getByRole('switch', { name: SWITCH }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Muitas solicitações em pouco tempo',
    );
    expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked();
    expect(screen.getByRole('switch', { name: SWITCH })).toBeEnabled();
  });

  it('keeps the switch where it was and says so when the request cannot be made', async () => {
    const user = userEvent.setup();
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    renderWithProviders(<Host initial={WHATSAPP_ON} />);

    await user.click(screen.getByRole('switch', { name: SWITCH }));

    expect(await screen.findByRole('alert')).toBeVisible();
    expect(screen.getByRole('switch', { name: SWITCH })).toBeChecked();
  });

  it('locks the switch and says it is saving while the answer is awaited', async () => {
    const user = userEvent.setup();
    let release: (response: Response) => void = () => undefined;
    fetchMock.mockReturnValue(new Promise<Response>((resolve) => (release = resolve)));
    renderWithProviders(<Host initial={WHATSAPP_ON} />);

    await user.click(screen.getByRole('switch', { name: SWITCH }));

    expect(screen.getByRole('switch', { name: SWITCH })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Salvando');
    release(json(WHATSAPP_OFF));
    await waitFor(() => expect(screen.getByRole('switch', { name: SWITCH })).toBeEnabled());
  });
});
