// SC-15 / AR-46: EmailService logs no address, name, token URL or support text, in the development
// simulation (no SMTP) or when mail is sent. Fake values only (TS-27).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmailService } from './email.service';
import { testConfigService } from '../../test/support/test-env';
import type { ConfigService } from '@nestjs/config';
import { expectNoneLogged, spyOnLogger } from '../../test/support/logger-spy';

const EMAIL = 'fulana.ficticia@example.test';
const SUPPORT = 'suporte-ficticio@example.test';
const NAME = 'Fulana Ficticia';
const TOKEN = 'token-ficticio-123';
const TITLE = 'titulo-ficticio';
const TEXT = 'descricao-ficticia-privada';
const PERSONAL = [EMAIL, SUPPORT, NAME, TOKEN, TITLE, TEXT, 'Natal'];
const reminder = {
  userName: NAME,
  auctionTitle: 'Casa ficticia',
  auctionCode: 'A-1',
  auctionCity: 'Natal',
  auctionState: 'RN',
  description: TEXT,
} as unknown as Parameters<EmailService['sendReminderEmail']>[1];

// No SMTP key at all: the transporter is never built (development mode).
const noSmtpConfig = configWith('test');
function configWith(nodeEnv: string) {
  return {
    get: (key: string) =>
      key === 'NODE_ENV' ? nodeEnv : key === 'FRONTEND_URL' ? 'http://localhost:3001' : undefined,
  } as unknown as ConfigService<never, true>;
}

afterEach(() => vi.restoreAllMocks());

async function sendAll(service: EmailService) {
  await service.sendVerificationEmail(EMAIL, TOKEN, NAME);
  await service.sendPasswordResetEmail(EMAIL, TOKEN, NAME);
  await service.sendSupportEmail(SUPPORT, EMAIL, NAME, TITLE, TEXT);
  await service.sendReminderEmail(EMAIL, reminder);
}

describe('EmailService logging', () => {
  it('logs no personal data in development mode (no SMTP configured)', async () => {
    const logger = spyOnLogger();
    const service = new EmailService(noSmtpConfig);
    await sendAll(service);
    expectNoneLogged(logger.loggedText(), PERSONAL);
  });

  it('logs no personal data when mail is sent', async () => {
    const logger = spyOnLogger();
    const service = new EmailService(testConfigService());
    (service as unknown as { transporter: unknown }).transporter = {
      sendMail: vi.fn().mockResolvedValue({}),
    };
    await sendAll(service);
    expectNoneLogged(logger.loggedText(), PERSONAL);
  });

  it('logs nothing from an SMTP failure that quotes the recipient', async () => {
    const logger = spyOnLogger();
    const service = new EmailService(testConfigService());
    (service as unknown as { transporter: unknown }).transporter = {
      sendMail: vi.fn().mockRejectedValue(new Error(`Invalid recipient ${EMAIL}`)),
    };
    await expect(service.sendReminderEmail(EMAIL, reminder)).rejects.toThrow();
    expect(logger.loggedText()).not.toContain(EMAIL);
  });

  it('prints the verification and reset links in development only (SC-16)', async () => {
    const logger = spyOnLogger();
    const service = new EmailService(configWith('development'));
    await service.sendVerificationEmail(EMAIL, TOKEN, NAME);
    await service.sendPasswordResetEmail(EMAIL, TOKEN, NAME);
    const logged = logger.loggedText();
    expect(logged).toContain(`http://localhost:3001/verify-email/${TOKEN}`);
    expect(logged).toContain(`http://localhost:3001/reset-password/${TOKEN}`);
    expectNoneLogged(logged, [EMAIL, NAME]);
  });

  it.each(['production', 'test'])(
    'logs neither token, link nor address in %s without SMTP',
    async (env) => {
      const logger = spyOnLogger();
      const service = new EmailService(configWith(env));
      await service.sendVerificationEmail(EMAIL, TOKEN, NAME);
      await service.sendPasswordResetEmail(EMAIL, TOKEN, NAME);
      expectNoneLogged(logger.loggedText(), [TOKEN, '/verify-email/', '/reset-password/', EMAIL]);
    },
  );
});
