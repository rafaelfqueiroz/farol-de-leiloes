// AR-41: the one description of the backend's environment, validated at boot. Pure (no Nest, no
// process.env) so the structural test can compare it with .env.example (AR-44).
//
// Every secret and integration value is required in every environment: there is no default and
// no "only in production" exception, so a missing value stops the boot instead of degrading
// silently (AR-41, SC-16). Non-secret tunables (port, flags, schedules, model names) have defaults.
// Flags use z.stringbool(), which reads "false" as false (z.coerce.boolean would read it as true).
import { z } from 'zod';

const required = z.string().min(1);
const url = z.url();
const flag = z.stringbool();
const positiveInt = z.coerce.number().int().positive();

export const LLM_PROVIDERS = ['ollama', 'groq', 'gemini', 'openai', 'anthropic'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

// The key each cloud provider needs; Ollama runs locally and needs none.
export const LLM_PROVIDER_KEY = {
  groq: 'GROQ_API_KEY',
  gemini: 'GOOGLE_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
} as const satisfies Record<Exclude<LlmProvider, 'ollama'>, string>;

// pino's levels (nestjs-pino maps Nest's log/verbose onto info/trace); `silent` turns logging off.
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

export const envSchema = z
  .object({
    // Server
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: positiveInt.default(3000),
    // SC-17: CORS uses an exact HTTP(S) origin, with no credentials, path, query or wildcard.
    FRONTEND_URL: url
      .refine((value) => {
        try {
          const parsed = new URL(value);
          return (
            ['http:', 'https:'].includes(parsed.protocol) &&
            !parsed.username &&
            !parsed.password &&
            parsed.pathname === '/' &&
            !parsed.search &&
            !parsed.hash &&
            !parsed.hostname.includes('*')
          );
        } catch {
          return false;
        }
      }, 'must be an HTTP(S) origin')
      .transform((value) => new URL(value).origin),
    // SC-04: how many reverse-proxy hops (Caddy = 1) sit in front of the API, so req.ip is the
    // client and not the proxy. 0 means the process is reached directly and X-Forwarded-For is
    // ignored, so a caller cannot spoof its address.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).default(0),
    MONGODB_URI: required,

    // Auth
    JWT_SECRET: required,
    GOOGLE_CLIENT_ID: required,
    GOOGLE_CLIENT_SECRET: required,
    GOOGLE_CALLBACK_URL: url,

    // Payments
    STRIPE_SECRET_KEY: required,
    STRIPE_WEBHOOK_SECRET: required,
    // SPEC-012 BR-012-17/19/29: the Stripe Billing Portal configuration (`bpc_...`) restricted to
    // the payment method and invoices, so plan changes and cancellations go through our own
    // endpoints. Optional: without it Stripe uses the account's default portal configuration.
    STRIPE_BILLING_PORTAL_CONFIGURATION_ID: required.optional(),

    // Email
    EMAIL_FROM: required,
    SMTP_HOST: required,
    SMTP_PORT: positiveInt.default(587),
    SMTP_SECURE: flag.default(false),
    SMTP_USER: required,
    SMTP_PASS: required,
    // SPEC-009 BR-009-03, BR-009-10: the support team's mailbox. It is where each new support request
    // is sent (BR-009-10) and the address the product shows to people who cannot sign in (BR-009-03,
    // BR-009-20). No default and no placeholder: a missing or malformed value stops the boot, so
    // the product never publishes an address nobody reads (AR-41).
    SUPPORT_EMAIL: z.email(),

    // Notifications
    SMS_PROVIDER_API_KEY: required,
    WHATSAPP_API_KEY: required,

    // AI search: only the selected provider's key is required (superRefine below).
    LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('ollama'),
    OLLAMA_MODEL: required.default('qwen2.5:3b'),
    OLLAMA_BASE_URL: url.default('http://localhost:11434/v1'),
    GROQ_MODEL: required.default('llama-3.1-8b-instant'),
    GROQ_API_KEY: required.optional(),
    GEMINI_MODEL: required.default('gemini-2.0-flash'),
    GOOGLE_API_KEY: required.optional(),
    OPENAI_MODEL: required.default('gpt-4o-mini'),
    OPENAI_API_KEY: required.optional(),
    ANTHROPIC_MODEL: required.default('claude-sonnet-4-20250514'),
    ANTHROPIC_API_KEY: required.optional(),

    // File storage (Cloudflare R2)
    CLOUDFLARE_ACCOUNT_ID: required,
    R2_ACCESS_KEY_ID: required,
    R2_SECRET_ACCESS_KEY: required,
    R2_BUCKET: required,
    R2_PUBLIC_URL: url,
    // SC-18 / BR-002-08: the bucket of CLIENT files (SPEC-017), with no public access at all. A
    // separate bucket, never R2_BUCKET (served openly at R2_PUBLIC_URL; superRefine below). Optional
    // until SPEC-017: without it, client file links are refused, never signed on the public bucket.
    R2_PRIVATE_BUCKET: required.optional(),

    // Scheduled jobs
    IMPORT_ENABLED: flag.default(true),
    IMPORT_ON_START_UP: flag.default(false),
    SCRAPER_ENABLED: flag.default(true),
    SCRAPER_ON_START_UP: flag.default(false),
    REMINDERS_ENABLED: flag.default(true),
    // SPEC-012 (ADR-005): the daily job that re-reads subscriptions from the payment provider.
    SUBSCRIPTIONS_RECONCILE_ENABLED: flag.default(true),
    // SPEC-010 BR-010-15: the daily job that deletes the personal data of closed accounts (AR-04).
    ACCOUNT_PURGE_ENABLED: flag.default(true),
    // SPEC-010 BR-010-11: the worker that builds the data exports (AR-04). A request is queued
    // whatever this says; with it off nothing is built until it is switched on again.
    DATA_EXPORT_ENABLED: flag.default(true),
    // SPEC-010 BR-010-21: the daily job that deletes the documents of journeys closed more than
    // DOCUMENT_RETENTION_YEARS ago (AR-04). Needs the closed-journey files source SPEC-017 binds;
    // until then it finds nothing.
    DOCUMENT_RETENTION_ENABLED: flag.default(true),
    // SPEC-009 BR-009-07: the worker that (re)sends the support emails of the outbox (AR-04). A
    // request is stored and its mails are tried at once whatever this says; with it off a failed
    // mail waits until it is switched on again.
    SUPPORT_MAIL_JOB_ENABLED: flag.default(true),
    CLEANUP_ON_STARTUP: flag.default(false),
    NEIGHBORHOODS_CACHE_ENABLED: flag.default(false),
    // Milliseconds; 600000 = 10 minutes.
    NEIGHBORHOODS_CACHE_TTL: positiveInt.default(600_000),

    // Business settings (AR-43): product decisions that change without a code change. The
    // defaults are the values the code carried as constants before (#74).
    // How many saved filters one user may keep (SPEC-007; the per-plan number is open, Q-15).
    SAVED_FILTERS_MAX_PER_USER: positiveInt.default(10),
    // Days an unavailable auction is kept before the cleanup job removes it and its files.
    UNAVAILABLE_AUCTION_RETENTION_DAYS: positiveInt.default(14),
    // SPEC-012 BR-012-28 (D-47): days an office stays fully working after its subscription lapsed,
    // before it becomes read-only until it pays again.
    SUBSCRIPTION_GRACE_DAYS: positiveInt.default(10),
    // SPEC-012 BR-012-29 (D-48, Q-21): days after the first payment's confirmation in which
    // cancelling the first subscription refunds it in full (CDC art. 49).
    REFUND_WINDOW_DAYS: positiveInt.default(7),

    // Privacy (SPEC-010 BR-010-05): whether an account that has not accepted the current terms and
    // privacy policy is refused the account features (403 TERMS_ACCEPTANCE_REQUIRED). Recording
    // acceptances is always on. Off by default while no screen asks for the acceptance; the
    // frontend change that adds it flips the default to true.
    TERMS_ENFORCEMENT_ENABLED: flag.default(false),
    // SPEC-010 BR-010-15 (AR-43): the legal ceiling, in days, between the closure of an account and
    // the deletion of its personal data (RNF-24). The purge job runs daily and normally finishes
    // within one day; this value is what the alert and the health text are measured against.
    ACCOUNT_PURGE_MAX_DAYS: positiveInt.default(30),
    // SPEC-010 BR-010-15: an error is logged when a closed account is still not purged this many
    // days after its closure, early enough to act before ACCOUNT_PURGE_MAX_DAYS (superRefine).
    ACCOUNT_PURGE_ALERT_DAYS: positiveInt.default(25),
    // SPEC-010 BR-010-11: days an export stays downloadable after it became ready, then it is
    // deleted (RNF-22).
    EXPORT_TTL_DAYS: positiveInt.default(7),
    // SPEC-010 BR-010-18, BR-010-24 (AR-43): whole years a closed journey's documents are kept after
    // its closing date (RNF-24, D-38). A setting, so a period the lawyer confirms differently takes
    // effect without a code change; provisional until the validation of BR-010-26 is recorded.
    DOCUMENT_RETENTION_YEARS: positiveInt.default(5),
    // SPEC-010 BR-010-25 (DL-010-07): whether the routes marked @RequiresLegalValidation refuse
    // requests until a lawyer's validation is recorded. Unset means true in production and false
    // elsewhere (legalGateEnforced in env.ts); a staging environment sets it to true.
    LEGAL_GATE_ENFORCED: flag.optional(),

    // Observability (ARCHITECTURE §11)
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    // AR-46: the HMAC key of the hashed user id in log lines. Required in production (superRefine
    // below); elsewhere it may be absent, and then no user id is logged at all: there is no
    // fallback key (AR-41).
    LOG_HASH_SECRET: z.string().min(32).optional(),
    // AR-47: absent means Sentry stays inert (src/instrument.ts).
    SENTRY_DSN: url.optional(),
  })
  .superRefine(
    (env, ctx) => {
      // Runs even when other variables failed (`when` below), so one boot lists every problem.
      // AR-41/AR-46: production never runs without the log hash key.
      if (env.NODE_ENV === 'production' && !env.LOG_HASH_SECRET) {
        ctx.addIssue({
          code: 'custom',
          path: ['LOG_HASH_SECRET'],
          message: 'required when NODE_ENV is production',
        });
      }
      // BR-010-15: an alert after the ceiling would never warn anybody in time.
      if (env.ACCOUNT_PURGE_ALERT_DAYS > env.ACCOUNT_PURGE_MAX_DAYS) {
        ctx.addIssue({
          code: 'custom',
          path: ['ACCOUNT_PURGE_ALERT_DAYS'],
          message: 'must not be more than ACCOUNT_PURGE_MAX_DAYS',
        });
      }
      // SC-18: a client file in the public bucket would be reachable at R2_PUBLIC_URL, unsigned.
      if (env.R2_PRIVATE_BUCKET !== undefined && env.R2_PRIVATE_BUCKET === env.R2_BUCKET) {
        ctx.addIssue({
          code: 'custom',
          path: ['R2_PRIVATE_BUCKET'],
          message: 'must not be R2_BUCKET, which is served publicly',
        });
      }
      // The provider itself may be the invalid value, hence the lookup guard.
      const provider = env.LLM_PROVIDER;
      if (provider === 'ollama' || !(provider in LLM_PROVIDER_KEY)) return;
      const key = LLM_PROVIDER_KEY[provider];
      if (!env[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `required when LLM_PROVIDER is ${provider}`,
        });
      }
    },
    { when: () => true },
  );

export type Env = z.output<typeof envSchema>;

/** The variable names the schema reads, for the .env.example check (AR-44). */
export const ENV_KEYS = Object.keys(envSchema.shape) as (keyof Env)[];
