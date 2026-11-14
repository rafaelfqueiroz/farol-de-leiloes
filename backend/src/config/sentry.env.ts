// AR-47: the slice of the environment Sentry needs, read before Nest exists. src/instrument.ts
// runs first in main.ts (Sentry must initialise before the modules it instruments load), so
// ConfigService is not available yet. It reads only NODE_ENV and SENTRY_DSN, with the boot schema's
// own validators, rather than validateEnv(process.env): the full validation would fail in
// development, where the required secrets are still in a .env file that ConfigModule has not
// loaded at that point.
//
// Never throws: an invalid value leaves Sentry inert here, and the boot-time validation of the
// whole environment then refuses to start, naming the variable (AR-41).
import { z } from 'zod';
import { envSchema } from './env.schema.js';

const sentryEnvSchema = z.object({
  NODE_ENV: envSchema.shape.NODE_ENV,
  SENTRY_DSN: envSchema.shape.SENTRY_DSN,
});

export type SentryEnv = z.output<typeof sentryEnvSchema>;

/** NODE_ENV and SENTRY_DSN out of a raw environment; an empty value counts as unset. */
export function parseSentryEnv(raw: Record<string, string | undefined>): SentryEnv | undefined {
  const result = sentryEnvSchema.safeParse({
    NODE_ENV: raw.NODE_ENV || undefined,
    SENTRY_DSN: raw.SENTRY_DSN || undefined,
  });
  return result.success ? result.data : undefined;
}

// AR-42: the config module is the only reader of process.env.
export function sentryEnvFromProcess(): SentryEnv | undefined {
  return parseSentryEnv(process.env);
}
