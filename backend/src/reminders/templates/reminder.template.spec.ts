// BR-003-18, BR-003-22, BR-003-23: the reminder e-mail is correct pt-BR and shows the reminder's
// Brasília date and time, whatever zone the server runs in. This spec runs under several host
// zones (vitest.config.mts, `tz-*` projects, TS-11): the date must not move with them.
import { describe, expect, it } from 'vitest';
import { getAuctionReminderEmailTemplate, type ReminderEmailPayload } from './reminder.template.js';

const payload = (overrides: Partial<ReminderEmailPayload> = {}): ReminderEmailPayload => ({
  userName: 'Fulana Ficticia',
  auctionTitle: 'Apartamento em Campinas',
  auctionCode: 'A-1',
  auctionCity: 'Campinas',
  auctionState: 'SP',
  auctionDetailsUrl: 'https://example.test/a1',
  description: 'Dar o lance antes do meio-dia',
  // 23:30 on 31/01/2026 in Brasília is already 01/02/2026 in UTC and 02/02 in Tokyo.
  scheduledAt: new Date('2026-02-01T02:30:00.000Z'),
  ...overrides,
});

describe('getAuctionReminderEmailTemplate', () => {
  it('shows the reminder in Brasília time with the marker, not the server day', () => {
    const html = getAuctionReminderEmailTemplate(payload());

    expect(html).toContain('31/01/2026 23:30 (horário de Brasília)');
    expect(html).not.toContain('01/02/2026');
    expect(html).not.toContain('02/02/2026');
  });

  it('uses pt-BR with its accents', () => {
    const html = getAuctionReminderEmailTemplate(payload());

    expect(html).toContain('<html lang="pt-BR">');
    for (const text of [
      'Lembrete de leilão',
      'Olá,',
      'Este é um lembrete sobre um leilão que você marcou para acompanhar:',
      'Código:',
      'Sua anotação:',
      'Ver detalhes do leilão',
      'Você recebeu este e-mail porque configurou um lembrete no Farol dos Leilões.',
      'por favor não responda',
    ]) {
      expect(html).toContain(text);
    }
    expect(html).not.toMatch(/Leilao|\bOla\b|\bvoce\b|Voce|anotacao|nao /);
  });

  it('falls back to the code, the missing-location text and no optional sections', () => {
    const html = getAuctionReminderEmailTemplate(
      payload({
        auctionTitle: null,
        auctionCity: null,
        auctionState: null,
        auctionDetailsUrl: null,
        description: null,
      }),
    );

    expect(html).toContain('<h3>A-1</h3>');
    expect(html).toContain('Local não informado');
    expect(html).not.toContain('Ver detalhes do leilão');
    expect(html).not.toContain('Sua anotação');
  });

  it('shows the location and the note when present', () => {
    const html = getAuctionReminderEmailTemplate(payload());

    expect(html).toContain('Campinas, SP');
    expect(html).toContain('Dar o lance antes do meio-dia');
    expect(html).toContain('href="https://example.test/a1"');
  });
});
