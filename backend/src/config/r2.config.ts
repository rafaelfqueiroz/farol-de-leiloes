import { registerAs } from '@nestjs/config';
import { validateEnv, type Env } from './env.js';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
}

/** The R2 settings out of the validated environment (AR-41). */
export function r2ConfigFrom(env: Env): R2Config {
  return {
    accountId: env.CLOUDFLARE_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    publicUrl: env.R2_PUBLIC_URL,
  };
}

// AR-42: the config module is the only reader of process.env.
export default registerAs('r2', (): R2Config => r2ConfigFrom(validateEnv(process.env)));
