export interface ReminderEmailPayload {
  userName: string;
  auctionTitle: string | null;
  auctionCode: string;
  auctionCity: string | null;
  auctionState: string | null;
  auctionDetailsUrl: string | null;
  description: string | null;
}

export const getAuctionReminderEmailTemplate = (payload: ReminderEmailPayload): string => {
  const location =
    [payload.auctionCity, payload.auctionState].filter(Boolean).join(', ') || 'Local nao informado';

  const detailsButton = payload.auctionDetailsUrl
    ? `<div style="text-align: center;">
        <a href="${payload.auctionDetailsUrl}" class="button">Ver Detalhes do Leilao</a>
      </div>`
    : '';

  const descriptionSection = payload.description
    ? `<div class="note">
        <strong>Sua anotacao:</strong>
        <p>${payload.description}</p>
      </div>`
    : '';

  return `
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
    .container {
      max-width: 600px;
      margin: 0 auto;
      padding: 40px 20px;
    }
    .card {
      background: white;
      border-radius: 8px;
      padding: 40px;
      box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    }
    h2 {
      color: #1976d2;
      margin-top: 0;
    }
    .auction-info {
      background: #f5f5f5;
      border-radius: 8px;
      padding: 20px;
      margin: 20px 0;
    }
    .auction-info h3 {
      margin-top: 0;
      color: #333;
    }
    .auction-detail {
      margin: 8px 0;
    }
    .auction-detail strong {
      color: #666;
    }
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
    .note {
      background: #fff3e0;
      border-left: 4px solid #f57c00;
      padding: 16px;
      margin: 20px 0;
      border-radius: 0 8px 8px 0;
    }
    .note p {
      margin: 8px 0 0 0;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 13px;
      color: #666;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h2>Lembrete de Leilao</h2>
      <p>Ola, <strong>${payload.userName}</strong>!</p>
      <p>Este e um lembrete sobre um leilao que voce marcou para acompanhar:</p>

      <div class="auction-info">
        <h3>${payload.auctionTitle || payload.auctionCode}</h3>
        <p class="auction-detail"><strong>Codigo:</strong> ${payload.auctionCode}</p>
        <p class="auction-detail"><strong>Local:</strong> ${location}</p>
      </div>

      ${descriptionSection}

      ${detailsButton}

      <div class="footer">
        <p>Voce recebeu este email porque configurou um lembrete no Farol dos Leiloes.</p>
        <p>Este email foi enviado automaticamente, por favor nao responda.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;
};
