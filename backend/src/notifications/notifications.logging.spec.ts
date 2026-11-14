// SC-15 / AR-46: the reminder channels never log the recipient, the user's name or the reminder
// text, in the development simulation or on the real path. Fake values only (TS-27).
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SmsService } from './sms.service.js';
import { WhatsAppService } from './whatsapp.service.js';
import type { ConfigService } from '@nestjs/config';
import { expectNoneLogged, spyOnLogger } from '../../test/support/logger-spy.js';

const PHONE = '+5500000000000';
const NAME = 'Fulana Ficticia';
const NOTE = 'nota-privada-ficticia';
const payload = {
  userName: NAME,
  auctionTitle: 'Casa ficticia',
  auctionCode: 'A-1',
  auctionCity: 'Natal',
  auctionState: 'RN',
  auctionDetailsUrl: 'https://example.test/a-1',
  description: NOTE,
};
const PERSONAL = [PHONE, NAME, NOTE];

// Only the provider key matters here: absent means development mode.
const configOf = (values: object) =>
  ({ get: (key: string) => (values as Record<string, unknown>)[key] }) as unknown as ConfigService<
    never,
    true
  >;

afterEach(() => vi.restoreAllMocks());

describe.each([
  ['SmsService', (config: object) => new SmsService(configOf(config)), 'SMS_PROVIDER_API_KEY'],
  [
    'WhatsAppService',
    (config: object) => new WhatsAppService(configOf(config)),
    'WHATSAPP_API_KEY',
  ],
] as const)('%s logging', (_name, build, keyName) => {
  const send = (service: SmsService | WhatsAppService) =>
    service instanceof SmsService
      ? service.sendReminderSms(PHONE, payload)
      : service.sendReminderWhatsApp(PHONE, payload);

  it('logs no personal data in development mode (no provider configured)', async () => {
    const logger = spyOnLogger();
    await send(build({ [keyName]: undefined }));
    expectNoneLogged(logger.loggedText(), PERSONAL);
  });

  it('logs no personal data when the message is sent', async () => {
    const logger = spyOnLogger();
    await send(build({ [keyName]: 'test-key' }));
    expectNoneLogged(logger.loggedText(), PERSONAL);
  });

  it('logs and returns only a stable code when the provider fails, never its message', async () => {
    const logger = spyOnLogger();
    // A Twilio-style error: numeric code, message quoting the destination number.
    const providerError = Object.assign(new Error(`The 'To' number ${PHONE} is not valid`), {
      code: 21211,
    });
    // The success log is the only call inside the try block, so making it throw stands in for the provider.
    vi.mocked(Logger.prototype.log).mockImplementationOnce(() => {
      throw providerError;
    });

    const result = await send(build({ [keyName]: 'test-key' }));

    expect(result).toEqual({ success: false, errorMessage: '21211' });
    expectNoneLogged(logger.loggedText(), PERSONAL);
    expect(logger.loggedText()).toContain('21211');
  });
});
