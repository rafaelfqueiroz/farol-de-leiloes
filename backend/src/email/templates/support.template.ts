// SPEC-009 BR-009-07, BR-009-10, BR-009-11 (#144): the two emails of a support request, each as an
// html part and a text part. Everything the requester typed (name, subject, message) reaches the html
// ONLY through escapeHtml, so markup in it is shown as text and never interpreted; the protocol is
// ours (domain/protocol.ts) and the address is escaped like any other value. The text part carries
// the same words with no markup at all.
import { escapeHtml, escapeHtmlWithLineBreaks } from '../../common/html/escape-html.js';
import { singleLine } from '../../common/text/single-line.js';

export interface SupportMailContent {
  readonly html: string;
  readonly text: string;
}

export interface SupportConfirmationInput {
  readonly protocol: string;
  readonly subject: string;
  readonly message: string;
}

export interface SupportNoticeInput extends SupportConfirmationInput {
  readonly requesterName: string;
  readonly requesterEmail: string;
}

const STYLE = `
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f5f5f5; }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .card { background: white; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
    h2 { color: #1d3b63; margin-top: 0; }
    .quote { background: #f5f5f5; border-radius: 4px; padding: 12px 16px; word-break: break-word; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #eee; font-size: 13px; color: #666; }`;

function page(body: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>${STYLE}
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
${body}
    </div>
  </div>
</body>
</html>
`;
}

/** BR-009-07: to the requester, at the account's current address: protocol, subject, a copy of the message. */
export function getSupportConfirmationEmail(raw: SupportConfirmationInput): SupportMailContent {
  // The subject is one line: a line break in it would forge a line of the text part.
  const input = { ...raw, subject: singleLine(raw.subject) };
  const html = page(`      <h2>Recebemos sua solicitação de suporte</h2>
      <p>Seu número de protocolo é <strong>${escapeHtml(input.protocol)}</strong>. Guarde-o para qualquer acompanhamento.</p>
      <p><strong>Assunto:</strong> ${escapeHtml(input.subject)}</p>
      <p><strong>Sua mensagem:</strong></p>
      <p class="quote">${escapeHtmlWithLineBreaks(input.message)}</p>
      <p>Nossa equipe responde por email, fora do produto.</p>
      <div class="footer">
        <p>Este email foi enviado automaticamente para confirmar o registro da sua solicitação.</p>
      </div>`);
  const text = [
    'Recebemos sua solicitação de suporte',
    '',
    `Protocolo: ${input.protocol}`,
    `Assunto: ${input.subject}`,
    '',
    'Sua mensagem:',
    input.message,
    '',
    'Nossa equipe responde por email, fora do produto.',
    '',
  ].join('\n');
  return { html, text };
}

/**
 * BR-009-10: to the support team: protocol, the requester's name and email, subject and message and
 * nothing else; nothing from the requester's data in the product is added.
 */
export function getSupportNoticeEmail(raw: SupportNoticeInput): SupportMailContent {
  // The subject and the name are one line each (see above): the notice is what the team reads.
  const input = {
    ...raw,
    subject: singleLine(raw.subject),
    requesterName: singleLine(raw.requesterName),
  };
  const html = page(`      <h2>Nova solicitação de suporte</h2>
      <p><strong>Protocolo:</strong> ${escapeHtml(input.protocol)}</p>
      <p><strong>Solicitante:</strong> ${escapeHtml(input.requesterName)} (${escapeHtml(input.requesterEmail)})</p>
      <p><strong>Assunto:</strong> ${escapeHtml(input.subject)}</p>
      <p><strong>Mensagem:</strong></p>
      <p class="quote">${escapeHtmlWithLineBreaks(input.message)}</p>
      <div class="footer">
        <p>Responder a este email responde ao solicitante.</p>
      </div>`);
  const text = [
    'Nova solicitação de suporte',
    '',
    `Protocolo: ${input.protocol}`,
    `Solicitante: ${input.requesterName} (${input.requesterEmail})`,
    `Assunto: ${input.subject}`,
    '',
    'Mensagem:',
    input.message,
    '',
  ].join('\n');
  return { html, text };
}
