// AR-47: the Sentry options of the backend, built from the slice of the environment
// src/instrument.ts can read before Nest exists (config/sentry.env.ts).
//
// Inert — no init at all — without a DSN, and always in tests (TS-07: no test reaches a live
// external system), whatever the environment holds.
import type { NodeOptions } from '@sentry/nestjs';
import type { SentryEnv } from '../../config/sentry.env';
import { scrubBreadcrumb, scrubEvent } from './sentry-scrubber';

export const NO_PERSONAL_DATA = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  mcp: { inputs: false, outputs: false },
} as const satisfies NonNullable<NodeOptions['dataCollection']>;

export function sentryOptions(env: SentryEnv | undefined): NodeOptions | undefined {
  if (!env?.SENTRY_DSN || env.NODE_ENV === 'test') return undefined;
  return {
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    // AR-47 asks for `sendDefaultPii: false`; Sentry SDK v11 replaced that flag with
    // `dataCollection`, set here to collect nothing personal: no user, cookies, headers, bodies,
    // query parameters, database or queue payloads, AI/MCP content or frame variables (SC-15).
    dataCollection: NO_PERSONAL_DATA,
    includeLocalVariables: false,
    // No tracing: errors only (no tracesSampleRate, so no performance data leaves the API).
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  };
}
