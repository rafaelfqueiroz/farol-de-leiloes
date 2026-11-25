// SPEC-004 BR-004-29: the email every platform admin gets when the Caixa import of a day ends badly.
// Fixed catalogue text plus the day and the codes of the run: nothing from a list, no personal data.
import type { ImportAlertContent } from '../../auctions/domain/import-alert-text.js';

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const getImportAlertEmailTemplate = (alert: ImportAlertContent): string => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
    }
    .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
    .card { background: white; border-radius: 8px; padding: 40px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
    h2 { color: #b3261e; margin-top: 0; }
    .codes { word-break: break-all; color: #666; font-size: 14px; background: #f5f5f5; padding: 12px; border-radius: 4px; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #eee; font-size: 13px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h2>Importação do Caixa: ${escapeHtml(alert.outcomeLabel)}</h2>
      <p><strong>Dia (horário de Brasília):</strong> ${escapeHtml(alert.date)}</p>
      <p><strong>Resultado:</strong> ${escapeHtml(alert.outcomeLabel)}</p>
      <p><strong>Motivo:</strong> ${escapeHtml(alert.reasonText)}</p>
      <p>Os dados dos imóveis e o horário da última atualização ficaram como estavam antes, exceto quando o resultado diz que a lista foi aplicada.</p>
      <p>Códigos da execução (para consultar o registro e o runbook):</p>
      <p class="codes">${alert.codes.length === 0 ? '-' : alert.codes.map(escapeHtml).join(', ')}</p>

      <div class="footer">
        <p>Todos os administradores recebem este aviso, uma vez por execução.</p>
        <p>Este email foi enviado automaticamente, por favor não responda.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;
