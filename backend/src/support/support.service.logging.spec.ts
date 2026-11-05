// SC-15 / AR-46: a support request is logged without the sender or any of its content.
import { afterEach, describe, it, vi } from 'vitest';
import { SupportService } from './support.service';
import { expectNoneLogged, spyOnLogger } from '../../test/support/logger-spy';

afterEach(() => vi.restoreAllMocks());

describe('SupportService logging', () => {
  it('logs neither the sender email, the name, the title nor the description', async () => {
    const logger = spyOnLogger();
    const emailService = { sendSupportEmail: vi.fn().mockResolvedValue(undefined) };
    const service = new SupportService(
      emailService as unknown as ConstructorParameters<typeof SupportService>[0],
    );

    await service.submitSupportRequest('u1', 'fulana.ficticia@example.test', 'Fulana Ficticia', {
      title: 'titulo-ficticio',
      description: 'descricao-ficticia-privada',
    });

    expectNoneLogged(logger.loggedText(), [
      'fulana.ficticia@example.test',
      'Fulana Ficticia',
      'titulo-ficticio',
      'descricao-ficticia-privada',
    ]);
  });
});
