// AR-47, SC-15: the options shared by the browser, server and edge Sentry inits. A DSN is public
// by design, so `NEXT_PUBLIC_SENTRY_DSN` is acceptable (SC-16). Without one Sentry stays inert, and
// it is always inert under test (TS-07). Read through lib/env.ts only (AR-42).
import type { ErrorEvent, Breadcrumb, init } from '@sentry/nextjs';
import { isTestRuntime, publicEnv } from '@/lib/env';
import { scrubBreadcrumb, scrubEvent } from '@/lib/sentry-scrubber';

// The options type every init (browser, node, edge) accepts: a key the SDK does not know, or no
// longer knows, fails typecheck instead of being silently ignored.
type InitOptions = NonNullable<Parameters<typeof init>[0]>;

// Collect nothing personal: no user, cookies, headers, bodies, query parameters, database or queue
// payloads, AI/MCP/GraphQL content or frame variables (SC-15).
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
} as const satisfies NonNullable<InitOptions['dataCollection']>;

export function sentryOptions(dsn: string | undefined = publicEnv.sentryDsn) {
  return {
    dsn,
    enabled: Boolean(dsn) && !isTestRuntime,
    // AR-47 asks for `sendDefaultPii: false`; Sentry SDK v11 replaced that flag with
    // `dataCollection`, set here to collect nothing personal (SC-15).
    dataCollection: NO_PERSONAL_DATA,
    // No tracing, no session replay, no profiling: errors only.
    tracesSampleRate: 0,
    beforeSend: (event: ErrorEvent): ErrorEvent => scrubEvent(event),
    beforeBreadcrumb: (crumb: Breadcrumb): Breadcrumb | null => scrubBreadcrumb(crumb),
  } satisfies InitOptions;
}
