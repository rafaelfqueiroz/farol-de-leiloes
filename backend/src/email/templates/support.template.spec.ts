// SPEC-009 BR-009-07, BR-009-10, BR-009-11 (#144): what the two support emails say, and that text
// the requester typed is literal in both parts. Fake values only (TS-27). No date is printed, so
// this spec needs no time-zone variants.
import { describe, expect, it } from 'vitest';
import { getSupportConfirmationEmail, getSupportNoticeEmail } from './support.template.js';

const MARKUP = '<b>teste</b><script>alert(1)</script>';
const base = {
  protocol: 'FL-2026-000042',
  subject: `Assunto ${MARKUP}`,
  message: `Linha um ${MARKUP}\nLinha <a href="https://x.example.test">dois</a>`,
};
const notice = {
  ...base,
  requesterName: `Fulana <i>Ficticia</i>`,
  requesterEmail: 'fulana.ficticia@example.test',
};

describe('the confirmation email to the requester (BR-009-07)', () => {
  const { html, text } = getSupportConfirmationEmail(base);

  it('carries the protocol, the subject and a copy of the message in both parts', () => {
    expect(html).toContain('<strong>FL-2026-000042</strong>');
    expect(text).toContain('Protocolo: FL-2026-000042');
    expect(text).toContain(`Assunto: ${base.subject}`);
    expect(text).toContain(base.message);
  });

  it('BR-009-11: shows typed markup as literal text in the html and keeps only its own <br>', () => {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<b>teste</b>');
    expect(html).not.toContain('<a href="https://x.example.test">');
    expect(html).toContain('Assunto:</strong> Assunto &lt;b&gt;teste&lt;/b&gt;&lt;script&gt;');
    expect(html).toContain(
      'Linha um &lt;b&gt;teste&lt;/b&gt;&lt;script&gt;alert(1)&lt;/script&gt;<br>Linha &lt;a href=&quot;https://x.example.test&quot;&gt;dois&lt;/a&gt;',
    );
  });

  it('puts no markup at all in the text part', () => {
    expect(text).not.toContain('<br>');
    expect(text).not.toContain('&lt;');
  });
});

describe('the notice to the support team (BR-009-10)', () => {
  const { html, text } = getSupportNoticeEmail(notice);

  it('carries the protocol, the requester name and email, the subject and the message', () => {
    expect(text).toContain('Protocolo: FL-2026-000042');
    expect(text).toContain('Solicitante: Fulana <i>Ficticia</i> (fulana.ficticia@example.test)');
    expect(text).toContain(`Assunto: ${base.subject}`);
    expect(text).toContain(base.message);
    expect(html).toContain('fulana.ficticia@example.test');
  });

  it('BR-009-11: the requester name, subject and message are literal in the html', () => {
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<i>');
    expect(html).not.toContain('<a href="https://x.example.test">');
    expect(html).toContain('Fulana &lt;i&gt;Ficticia&lt;/i&gt;');
    expect(html).toContain('<br>');
  });

  it('adds nothing about the requester beyond those five fields', () => {
    expect(text).toBe(
      [
        'Nova solicitação de suporte',
        '',
        'Protocolo: FL-2026-000042',
        `Solicitante: ${notice.requesterName} (${notice.requesterEmail})`,
        `Assunto: ${notice.subject}`,
        '',
        'Mensagem:',
        notice.message,
        '',
      ].join('\n'),
    );
  });
});

describe('a person cannot forge a line of the plain-text notice (BR-009-10, BR-009-11)', () => {
  const forged = {
    protocol: 'FL-2026-000042',
    subject: 'x\nSolicitante: CEO (ceo@banco.example.test)',
    message: 'Mensagem ficticia de teste',
    requesterName: 'Fulana\r\nProtocolo: FL-1999-000001\u202E',
    requesterEmail: 'fulana.ficticia@example.test',
  };

  it('keeps the subject and the name on their own line, with no control or bidi character', () => {
    const { text, html } = getSupportNoticeEmail(forged);
    const lines = text.split('\n');

    expect(lines.filter((line) => line.startsWith('Solicitante:'))).toEqual([
      'Solicitante: Fulana Protocolo: FL-1999-000001 (fulana.ficticia@example.test)',
    ]);
    expect(lines.filter((line) => line.startsWith('Protocolo:'))).toEqual([
      'Protocolo: FL-2026-000042',
    ]);
    expect(lines).toContain('Assunto: x Solicitante: CEO (ceo@banco.example.test)');
    for (const part of [text, html]) expect(part).not.toMatch(/[\u202A-\u202E\u2066-\u2069]/);
  });

  it('does the same for the subject of the confirmation', () => {
    const { text } = getSupportConfirmationEmail({ ...forged });

    expect(text.split('\n').filter((line) => line.startsWith('Protocolo:'))).toEqual([
      'Protocolo: FL-2026-000042',
    ]);
    expect(text).toContain('Assunto: x Solicitante: CEO (ceo@banco.example.test)');
  });

  it('leaves the message its own line breaks', () => {
    const { text } = getSupportNoticeEmail({ ...forged, message: 'um\ndois' });

    expect(text).toContain('Mensagem:\num\ndois\n');
  });
});
