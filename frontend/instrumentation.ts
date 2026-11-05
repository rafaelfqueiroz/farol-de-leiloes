// AR-47: Next.js loads this once per server instance. `onRequestError` reports unhandled
// server-render errors through the same scrubbing options as every other runtime (SC-15).
import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry-options';

export function register(): void {
  // The same options serve the Node.js and edge runtimes.
  Sentry.init(sentryOptions());
}

export const onRequestError = Sentry.captureRequestError;
