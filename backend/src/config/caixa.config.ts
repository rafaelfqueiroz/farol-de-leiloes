import { registerAs } from '@nestjs/config';
import { validateEnv, type Env } from './env.js';

/** SPEC-004, SC-24, ADR-003: how the CaixaAccess HTTP adapter reaches Caixa. */
export interface CaixaConfig {
  /** An http(s) proxy Caixa traffic leaves through; absent means a direct connection. */
  proxyUrl?: string;
  /** Milliseconds one request may take, connection to last byte. */
  requestTimeoutMs: number;
  /** Bytes a response may carry. */
  maxDownloadBytes: number;
}

export const KEY = 'CaixaConfig';

/** The Caixa access settings out of the validated environment (AR-41). */
export function caixaConfigFrom(env: Env): CaixaConfig {
  return {
    ...(env.CAIXA_PROXY_URL !== undefined ? { proxyUrl: env.CAIXA_PROXY_URL } : {}),
    requestTimeoutMs: env.CAIXA_REQUEST_TIMEOUT_MS,
    maxDownloadBytes: env.CAIXA_MAX_DOWNLOAD_BYTES,
  };
}

// AR-42: the config module is the only reader of process.env.
export default registerAs(KEY, (): CaixaConfig => caixaConfigFrom(validateEnv(process.env)));
