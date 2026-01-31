export const getVerificationEmailTemplate = (
  name: string,
  verificationUrl: string,
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
    .button:hover {
      background-color: #1565c0;
    }
    .link-text {
      word-break: break-all;
      color: #666;
      font-size: 14px;
      background: #f5f5f5;
      padding: 12px;
      border-radius: 4px;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 13px;
      color: #666;
    }
    .expiry {
      color: #f57c00;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h2>Verifique seu email</h2>
      <p>Ola, <strong>${name}</strong>!</p>
      <p>Obrigado por se cadastrar no Farol dos Leiloes.</p>
      <p>Para completar seu cadastro e ter acesso completo a plataforma, por favor verifique seu email clicando no botao abaixo:</p>

      <div style="text-align: center;">
        <a href="${verificationUrl}" class="button">Verificar Email</a>
      </div>

      <p>Ou copie e cole o link abaixo no seu navegador:</p>
      <p class="link-text">${verificationUrl}</p>

      <p class="expiry">Este link expira em 24 horas.</p>

      <div class="footer">
        <p>Se voce nao criou uma conta no Farol dos Leiloes, por favor ignore este email.</p>
        <p>Este email foi enviado automaticamente, por favor nao responda.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;

export const getPasswordResetEmailTemplate = (
  name: string,
  resetUrl: string,
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
    .link-text {
      word-break: break-all;
      color: #666;
      font-size: 14px;
      background: #f5f5f5;
      padding: 12px;
      border-radius: 4px;
    }
    .footer {
      margin-top: 32px;
      padding-top: 20px;
      border-top: 1px solid #eee;
      font-size: 13px;
      color: #666;
    }
    .expiry {
      color: #f57c00;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="card">
      <h2>Redefinir Senha</h2>
      <p>Ola, <strong>${name}</strong>!</p>
      <p>Recebemos uma solicitacao para redefinir a senha da sua conta no Farol dos Leiloes.</p>
      <p>Clique no botao abaixo para criar uma nova senha:</p>

      <div style="text-align: center;">
        <a href="${resetUrl}" class="button">Redefinir Senha</a>
      </div>

      <p>Ou copie e cole o link abaixo no seu navegador:</p>
      <p class="link-text">${resetUrl}</p>

      <p class="expiry">Este link expira em 1 hora.</p>

      <div class="footer">
        <p>Se voce nao solicitou a redefinicao de senha, por favor ignore este email. Sua senha permanecera a mesma.</p>
        <p>Este email foi enviado automaticamente, por favor nao responda.</p>
      </div>
    </div>
  </div>
</body>
</html>
`;
