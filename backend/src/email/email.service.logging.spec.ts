// SC-15 / AR-46: EmailService logs no address, name, token URL or support text, in the development
// simulation (no SMTP) in every environment or when mail is sent. Fake values only (TS-27).
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

// No SMTP key at all: the transporter is never built.
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
  it.each(['development', 'test', 'production'])(
    'SC-15 / SC-16: logs no personal data or token links in %s without SMTP',
    async (env) => {
      const logger = spyOnLogger();
      const service = new EmailService(configWith(env));
      await sendAll(service);
      const logged = logger.loggedText();
      expectNoneLogged(logged, [
        ...PERSONAL,
        'http://localhost:3001',
        '/verify-email/',
        '/reset-password/',
      ]);
      expect(logged).toContain('Verification email simulated (SMTP not configured)');
      expect(logged).toContain('Password reset email simulated (SMTP not configured)');
    },
  );

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
});
