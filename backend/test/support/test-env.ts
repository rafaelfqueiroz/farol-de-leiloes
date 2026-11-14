// A complete, valid environment for specs, made of obviously fake values (TS-27): every secret
// is required in every environment (AR-41), so a spec that needs configuration takes it from
// here instead of a .env file (DV-19). None of these values reaches a real service: specs replace
// the providers or never call them (TS-07).
import type { ConfigService } from '@nestjs/config';
import { validateEnv, type Env } from '../../src/config/env';
import { businessConfigFrom, type BusinessConfig } from '../../src/config/business.config';

export const TEST_ENV = {
  NODE_ENV: 'test',
  FRONTEND_URL: 'http://localhost:3001',
  MONGODB_URI: 'mongodb://localhost:27017/never-used-by-unit-specs',
  JWT_SECRET: 'test-jwt-secret-not-a-real-one',
  GOOGLE_CLIENT_ID: 'test-google-client-id',
  GOOGLE_CLIENT_SECRET: 'test-google-client-secret',
  GOOGLE_CALLBACK_URL: 'http://localhost:3000/api/auth/google/callback',
  STRIPE_SECRET_KEY: 'sk_test_fake',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_secret',
  STRIPE_STANDARD_PRICE_ID: 'price_test_standard',
  EMAIL_FROM: 'noreply@example.test',
  SMTP_HOST: 'smtp.example.test',
  SMTP_USER: 'test-smtp-user',
  SMTP_PASS: 'test-smtp-pass',
  SMS_PROVIDER_API_KEY: 'test-sms-key',
  WHATSAPP_API_KEY: 'test-whatsapp-key',
  CLOUDFLARE_ACCOUNT_ID: 'test-account',
  R2_ACCESS_KEY_ID: 'test-r2-access-key',
  R2_SECRET_ACCESS_KEY: 'test-r2-secret',
  R2_BUCKET: 'test-bucket',
  R2_PUBLIC_URL: 'https://files.example.test',
  // Tests are silent (TESTING §2): whatever builds the pino logger in a spec logs nothing.
  LOG_LEVEL: 'silent',
  // Required in production (AR-46), so a spec overriding NODE_ENV=production still boots.
  LOG_HASH_SECRET: 'test-log-hash-secret-not-a-real-one-000',
} as const satisfies Record<string, string>;

/** The validated test environment, with `overrides` (raw strings, as the process would hold). */
export function testEnv(overrides: Record<string, string | undefined> = {}): Env {
  return validateEnv({ ...TEST_ENV, ...overrides });
}

/**
 * A ConfigService over testEnv() for `{ provide: ConfigService, useValue: testConfigService() }`.
 * It never falls back to process.env, unlike the real one.
 */
export function testConfigService(
  overrides: Record<string, string | undefined> = {},
): ConfigService<Env, true> {
  const env = testEnv(overrides);
  const get = (key: keyof Env) => env[key];
  return { get, getOrThrow: get } as unknown as ConfigService<Env, true>;
}

/** The business settings (AR-43) of testEnv(), for `{ provide: businessConfig.KEY, useValue }`. */
export function testBusinessConfig(
  overrides: Record<string, string | undefined> = {},
): BusinessConfig {
  return businessConfigFrom(testEnv(overrides));
}
