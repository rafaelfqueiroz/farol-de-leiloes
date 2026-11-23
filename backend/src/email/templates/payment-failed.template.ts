// SPEC-012 BR-012-20: the email every member of an office gets when a renewal payment fails, with a
// link to update the payment method. The name is a member's own text, so it is escaped.
import { escapeHtml } from '../../common/html/escape-html.js';

export const getPaymentFailedEmailTemplate = (
  name: string | undefined,
  planUrl: string,
): string => `
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
    h2 { color: #1976d2; margin-top: 0; }
    .button {
      display: inline-block;
      padding: 14px 28px;
      background-color: #1976d2;
      color: white !important;
      text-decoration: none;
      border-radius: 6px;
      margin: 24px 0;
      font-weight: 500;
    }
    .link-text { word-break: break-all; color: #666; font-size: 14px; background: #f5f5f5; padding: 12px; border-radius: 4px; }
    .footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid #eee; font-size: 13px; color: #666; }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h2>Não conseguimos cobrar a renovação do plano</h2>
      <p>${name === undefined ? 'Olá!' : `Olá, <strong>${escapeHtml(name)}</strong>!`}</p>
      <p>A cobrança da renovação do plano do seu escritório no Farol dos Leilões não foi concluída. Vamos tentar de novo nos próximos dias.</p>
      <p>Para evitar que o plano seja encerrado, atualize a forma de pagamento:</p>

      <div style="text-align: center;">
        <a href="${planUrl}" class="button">Atualizar forma de pagamento</a>
      </div>

      <p>Ou copie e cole o link abaixo no seu navegador:</p>
      <p class="link-text">${planUrl}</p>

      <p>Enquanto a cobrança é tentada, o plano continua valendo e as jornadas em andamento seguem normalmente.</p>

      <div class="footer">
        <p>Todos os membros do escritório recebem este aviso.</p>
        <p>Este email foi enviado automaticamente, por favor não responda.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;
