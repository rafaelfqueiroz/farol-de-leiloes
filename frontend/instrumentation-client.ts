// AR-47: browser init (Next.js loads this before hydration). No tracing, no replay, scrubbed
// events and breadcrumbs (SC-15); inert without NEXT_PUBLIC_SENTRY_DSN.
import * as Sentry from '@sentry/nextjs';
import { sentryOptions } from '@/lib/sentry-options';

Sentry.init(sentryOptions());
