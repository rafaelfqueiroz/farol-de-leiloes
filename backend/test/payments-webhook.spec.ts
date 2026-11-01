import { BadRequestException, RawBodyRequest } from '@nestjs/common';
import { Request } from 'express';
import { PaymentsController } from '../src/payments/payments.controller';
import { PaymentsService } from '../src/payments/payments.service';

type ServiceDeps = ConstructorParameters<typeof PaymentsService>;

describe('Stripe webhook', () => {
  it('rejects a request without a raw body as an invalid signature (DV-03)', async () => {
    const paymentsService = { handleWebhook: jest.fn() };
    const controller = new PaymentsController(paymentsService as unknown as PaymentsService);
    const req = { rawBody: undefined } as RawBodyRequest<Request>;

    await expect(controller.handleWebhook(req, 'signature')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(paymentsService.handleWebhook).not.toHaveBeenCalled();
  });

  it('rejects every event as an invalid signature when no webhook secret is configured (DV-03)', async () => {
    const configService = {
      getOrThrow: jest.fn().mockReturnValue('sk_test_fake'),
      get: jest.fn().mockReturnValue(undefined),
    };
    const service = new PaymentsService(
      configService as unknown as ServiceDeps[0],
      {} as ServiceDeps[1],
      {} as ServiceDeps[2],
    );

    await expect(service.handleWebhook(Buffer.from('{}'), 'signature')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
