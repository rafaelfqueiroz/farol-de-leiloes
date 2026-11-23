// Issue #144 / SPEC-009 BR-009-11: text typed by the user is plain text in every support email.
// Regression: the html part of the old support mail interpolated name, title and description raw,
// so markup in them was interpreted by the mail client. This spec was written against that code
// first and failed on it (an html part holding a live <script> and <a href>). Fake values only (TS-27).
import { describe, expect, it, vi } from 'vitest';
import {
  EmailService,
  SMTP_TIMEOUTS,
  smtpTransportOptions,
  supportConfirmationMessageId,
} from './email.service.js';
import { testConfigService } from '../../test/support/test-env.js';

const SCRIPT = '<script>alert(1)</script>';
const LINK = '<a href="https://phishing.example.test/login">entre aqui</a>';

function serviceWithTransport() {
  const sendMail = vi.fn().mockResolvedValue({});
  const service = new EmailService(testConfigService());
  (service as unknown as { transporter: unknown }).transporter = { sendMail };
  const sent = () => sendMail.mock.calls.map((call) => call[0] as Record<string, unknown>);
  return { service, sent };
}

describe('support emails never interpret user text as markup (#144, BR-009-11)', () => {
  const typed = {
    protocol: 'FL-2026-000001',
    subject: `Assunto ${LINK}`,
    message: `Mensagem <b>teste</b>${SCRIPT}\n${LINK}`,
  };

  it('the confirmation to the requester escapes the subject and the message in the html part', async () => {
    const { service, sent } = serviceWithTransport();

    await service.sendSupportConfirmationEmail({
      ...typed,
      to: 'fulana.ficticia@example.test',
      requestId: '64b7f00000000000000a0001',
    });

    const html = sent()[0]?.['html'] as string;
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<a href');
    expect(html).not.toContain('<b>teste</b>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;a href=&quot;https://phishing.example.test/login&quot;&gt;');
  });

  it('the notice to the team escapes the requester name, the subject and the message', async () => {
    const { service, sent } = serviceWithTransport();

    await service.sendSupportNoticeEmail({
      ...typed,
      to: 'suporte-ficticio@example.test',
      requesterName: `Fulana ${SCRIPT}`,
      requesterEmail: 'fulana.ficticia@example.test',
    });

    const html = sent()[0]?.['html'] as string;
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<a href');
    expect(html).not.toContain('<b>teste</b>');
    expect(html).toContain('Fulana &lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;a href=&quot;https://phishing.example.test/login&quot;&gt;');
  });

  it('puts nothing the requester typed in a header: the Subject is fixed text and the protocol', async () => {
    const { service, sent } = serviceWithTransport();

    await service.sendSupportConfirmationEmail({
      ...typed,
      subject: 'Oi\r\nBcc: alvo@example.test',
      to: 'fulana.ficticia@example.test',
      requestId: '64b7f00000000000000a0001',
    });
    await service.sendSupportNoticeEmail({
      ...typed,
      subject: 'Oi\r\nBcc: alvo@example.test',
      to: 'suporte-ficticio@example.test',
      requesterName: 'Fulana',
      requesterEmail: 'fulana.ficticia@example.test',
    });

    const [confirmation, notice] = sent();
    expect(confirmation?.['subject']).toBe(
      'Recebemos sua solicitação de suporte FL-2026-000001 - Farol dos Leilões',
    );
    expect(notice?.['subject']).toBe('[Suporte] Nova solicitação FL-2026-000001');
    // The header fields (everything but the bodies) hold nothing of what was typed.
    const headers = [confirmation, notice].map((message) =>
      Object.fromEntries(
        Object.entries(message ?? {}).filter(([key]) => key !== 'html' && key !== 'text'),
      ),
    );
    expect(JSON.stringify(headers)).not.toContain('Bcc: alvo');
  });

  it('BR-009-10: the notice goes to the given address, replying to the requester as a structured address', async () => {
    const { service, sent } = serviceWithTransport();

    await service.sendSupportNoticeEmail({
      ...typed,
      to: 'suporte-ficticio@example.test',
      requesterName: 'Fulana',
      requesterEmail: 'fulana.ficticia@example.test',
    });

    expect(sent()[0]).toMatchObject({
      to: 'suporte-ficticio@example.test',
      replyTo: { name: '', address: 'fulana.ficticia@example.test' },
    });
  });

  it('BR-009-07: the confirmation has a stable Message-ID from the request id and the sender domain', async () => {
    const { service, sent } = serviceWithTransport();
    const mail = {
      ...typed,
      to: 'fulana.ficticia@example.test',
      requestId: '64b7f00000000000000a0001',
    };

    await service.sendSupportConfirmationEmail(mail);
    await service.sendSupportConfirmationEmail(mail);

    // EMAIL_FROM of the test environment is noreply@example.test.
    expect(sent().map((message) => message['messageId'])).toEqual([
      '<support-confirmation-64b7f00000000000000a0001@example.test>',
      '<support-confirmation-64b7f00000000000000a0001@example.test>',
    ]);
  });
});

describe('supportConfirmationMessageId', () => {
  it('takes the domain of a bare address and of an address with a display name', () => {
    expect(supportConfirmationMessageId('abc', 'noreply@farol.example.test')).toBe(
      '<support-confirmation-abc@farol.example.test>',
    );
    expect(supportConfirmationMessageId('abc', 'Farol <noreply@farol.example.test>')).toBe(
      '<support-confirmation-abc@farol.example.test>',
    );
  });

  it('falls back to localhost when the sender has no readable domain', () => {
    expect(supportConfirmationMessageId('abc', 'sem-arroba')).toBe(
      '<support-confirmation-abc@localhost>',
    );
  });
});

describe('the SMTP transport is bounded (review of #186, finding 1)', () => {
  it('has timeouts well inside the 2-minute claim lease, unlike nodemailer’s defaults', () => {
    expect(SMTP_TIMEOUTS).toEqual({
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  });

  it('builds the transport options of the configured account with those timeouts', () => {
    expect(
      smtpTransportOptions({
        host: 'smtp.example.test',
        port: 587,
        secure: false,
        user: 'u',
        pass: 'p',
      }),
    ).toEqual({
      host: 'smtp.example.test',
      port: 587,
      secure: false,
      auth: { user: 'u', pass: 'p' },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
  });
});
