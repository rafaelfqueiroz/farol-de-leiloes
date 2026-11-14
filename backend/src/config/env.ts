// AR-41/AR-42: the boot-time validation that ConfigModule runs (`validate: validateEnv`), and the
// typed view of the result everywhere else.
import type { ConfigService } from '@nestjs/config';
import { envSchema, type Env } from './env.schema.js';

// Other modules import from here: AR-09's lint reads any `*.schema` path as a Mongoose schema.
export type { Env, LlmProvider } from './env.schema.js';

/**
 * The typed ConfigService: `config.get('PORT', { infer: true })` is a number, never undefined.
 *
 * Constructor injection must spell it `ConfigService<Env, true>`: TypeScript emits a type alias as
 * `Object` in the decorator metadata, so Nest could not resolve a parameter typed with this alias.
 * Use the alias where no metadata is involved (factories with `inject: [ConfigService]`).
 */
export type AppConfigService = ConfigService<Env, true>;

/**
 * Parses the raw environment against the schema. An empty value counts as unset, so `KEY=` in a
 * .env file takes the default or fails as missing instead of failing as malformed.
 *
 * SC-16: the error names the variables and what is wrong with them, never their values.
 */
export function validateEnv(raw: Record<string, unknown>): Env {
  const present = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(present);
  if (result.success) return result.data;

  const problems = result.error.issues.map((issue) => {
    const name = issue.path.join('.') || '(environment)';
    const missing = issue.code !== 'custom' && present[String(issue.path[0])] === undefined;
    return `  ${name}: ${missing ? 'missing' : issue.message}`;
  });
  throw new Error(`Invalid environment configuration (AR-41):\n${problems.join('\n')}`);
}
