// TS-22: the API of the E2E Compose stack (frontend/e2e/compose.e2e.yml), with every provider
// replaced by a fake. It is the production AppModule — same controllers, guards, validation and
// error shape through configureApp — compiled with the testing module's provider overrides:
//
//   Caixa       AuctionsImporter (the only @Cron host of the import, SPEC-004 part 3),
//               ImportOrchestrator (the tick it calls) and AuctionDetailsScraper are inert
//               values: no @Cron is registered and nothing runs at start-up, so the stack never
//               reaches Caixa and never sends an import alert. The catalog comes from the
//               reference-workload seed instead (BR-003-08).
//   Stripe      FakePaymentGateway (test/fakes), the port's own fake (AR-10).
//   SMTP        E2eEmailSender: emails are recorded in memory, never sent.
//   Google      Not overridden: GoogleStrategy only builds a redirect URL, and no E2E journey
//               follows it yet; the SPEC-001 sign-in journey stubs it (TESTING §6).
//   LLM, R2, SMS, WhatsApp
//               Pointed by the stack's environment at a closed loopback port or left idle
//               (reminders off), so a call fails at once instead of reaching a provider.
//
// SECURITY (TS-07, SC-16): this file is never in a production image. It lives under test/, which
// tsconfig.build.json excludes, and it needs @nestjs/testing, a dev dependency the production
// image prunes; only backend/e2e.Dockerfile builds it. It also refuses NODE_ENV=production.
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/app.setup.js';
import { AuctionsImporter } from '../../src/auctions/importer/scheduler.js';
import { ImportOrchestrator } from '../../src/auctions/importer/import-orchestrator.service.js';
import { AuctionDetailsScraper } from '../../src/auctions/scraper/scraper-scheduler.js';
import { EmailService } from '../../src/email/email.service.js';
import { PaymentGateway } from '../../src/payments/payment-gateway.js';
import { FakePaymentGateway } from '../fakes/fake-payment-gateway.js';
import { E2eEmailSender } from './e2e-email-sender.js';

async function bootstrap(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The E2E API with fake providers never runs with NODE_ENV=production');
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(AuctionsImporter)
    .useValue({})
    .overrideProvider(ImportOrchestrator)
    .useValue({ tick: () => Promise.resolve() })
    .overrideProvider(AuctionDetailsScraper)
    .useValue({})
    .overrideProvider(PaymentGateway)
    .useValue(new FakePaymentGateway())
    .overrideProvider(EmailService)
    .useValue(new E2eEmailSender())
    .compile();

  // As main.ts: the raw body for the Stripe webhook route, the pino logger (AR-45).
  const app = moduleRef.createNestApplication({ rawBody: true, bufferLogs: true });
  app.useLogger(app.get(PinoLogger));
  configureApp(app);
  await app.listen(Number(process.env.PORT ?? 3000));
}

bootstrap().catch((error: unknown) => {
  new Logger('E2eBootstrap').error(
    `Failed to start: ${error instanceof Error ? error.name : 'unknown error'}`,
  );
  process.exit(1);
});
