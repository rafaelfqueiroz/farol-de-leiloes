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

  it('#144: shows what the user typed (name, title, code, place, note) as literal text', () => {
    const html = getAuctionReminderEmailTemplate(
      payload({
        userName: '<b>Fulana</b>',
        auctionTitle: '<script>alert(1)</script>Casa',
        auctionCode: 'A-<i>1</i>',
        auctionCity: 'Cam<u>pinas</u>',
        auctionState: 'S&P',
        description: 'Dar o <a href="https://phishing.example.test">lance</a>\'',
      }),
    );

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>Fulana</b>');
    expect(html).not.toContain('<i>1</i>');
    expect(html).not.toContain('<u>pinas</u>');
    expect(html).not.toContain('<a href="https://phishing.example.test">');
    expect(html).toContain('<strong>&lt;b&gt;Fulana&lt;/b&gt;</strong>');
    expect(html).toContain('<h3>&lt;script&gt;alert(1)&lt;/script&gt;Casa</h3>');
    expect(html).toContain('<strong>Código:</strong> A-&lt;i&gt;1&lt;/i&gt;');
    expect(html).toContain('<strong>Local:</strong> Cam&lt;u&gt;pinas&lt;/u&gt;, S&amp;P');
    expect(html).toContain(
      '<p>Dar o &lt;a href=&quot;https://phishing.example.test&quot;&gt;lance&lt;/a&gt;&#39;</p>',
    );
  });

  it('#144: escapes the code shown in place of a missing title, and keeps the details link', () => {
    const html = getAuctionReminderEmailTemplate(
      payload({ auctionTitle: null, auctionCode: '<b>X</b>' }),
    );

    expect(html).toContain('<h3>&lt;b&gt;X&lt;/b&gt;</h3>');
    expect(html).toContain('href="https://example.test/a1"');
  });
});
