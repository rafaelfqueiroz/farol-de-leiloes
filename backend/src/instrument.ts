// AR-47: Sentry initialises before anything else loads (main.ts imports this file first), as
// @sentry/nestjs requires. Config is not available yet, so the DSN comes from the config layer's
// own pre-boot reader (config/sentry.env.ts, AR-42). No DSN, or a test run, and Sentry stays inert:
// captureException is then a no-op (TS-07).
import * as Sentry from '@sentry/nestjs';
import { sentryEnvFromProcess } from './config/sentry.env';
import { sentryOptions } from './common/observability/sentry-options';

const options = sentryOptions(sentryEnvFromProcess());
if (options) Sentry.init(options);
