// AR-10: Caixa behind a port named for its role. Every request this product makes to
// venda-imoveis.caixa.gov.br (the daily list, a property's detail page, a file) goes through
// `CaixaAccess`, so there is ONE place that identifies itself honestly, paces itself, recognises a
// block and stops (SPEC-004 BR-004-18, BR-004-20, SC-24, ADR-003). HttpCaixaAccess is the default
// adapter; tests use FakeCaixaAccess (TS-03). Changing how Caixa is reached (a proxy, another
// transport, #108) changes the adapter and nothing else.

/** What a file from Caixa (matrícula, photo, edital) is: its bytes and what Caixa said it is. */
export interface CaixaFile {
  body: Buffer;
  contentType: string | null;
}

export abstract class CaixaAccess {
  /** The national list of properties (`Lista_imoveis_geral.csv`), decoded to text. */
  abstract downloadList(): Promise<string>;
  /** A property's detail page, decoded to text. `url` must be on Caixa's own site. */
  abstract fetchDetailPage(url: string): Promise<string>;
  /** A file on Caixa's own site. */
  abstract fetchFile(url: string): Promise<CaixaFile>;
}

/** Why Caixa said no. */
export type CaixaBlockReason =
  | 'HTTP_401'
  | 'HTTP_403'
  | 'HTTP_407'
  | 'HTTP_429'
  | 'HTTP_451'
  | 'HTTP_503'
  | 'RETRY_AFTER'
  | 'CHALLENGE_PAGE'
  | 'REDIRECT_OFF_SITE';

/**
 * Caixa (or the way to it) answered with a refusal, a challenge or a rate limit: 401, 403, 407,
 * 429, 451, 503 or any answer with a Retry-After header (Caixa asking to come back later is a rate limit), the Radware / ShieldSquare page (also in a 5xx body), a redirect away from the site. BR-004-20, SC-24: the caller STOPS for the run and
 * records it; nothing retries, switches address or tries to get past it.
 */
export class CaixaBlockedError extends Error {
  constructor(readonly reason: CaixaBlockReason) {
    // The message is the reason: it holds no URL, so a log line or a job record cannot leak one.
    super(`Caixa blocked the request: ${reason}`);
    this.name = 'CaixaBlockedError';
  }
}

export type CaixaUnreachableReason =
  'TIMEOUT' | 'NETWORK' | 'HTTP_STATUS' | 'RESPONSE_TOO_LARGE' | 'TOO_MANY_REDIRECTS';

/**
 * Caixa could not be reached or answered something other than the page asked for: a network
 * failure, a timeout, a 5xx, another 4xx (`status` says which), a body over the size cap. Unlike a
 * block, it affects only what was being fetched (BR-004-21).
 */
export class CaixaUnreachableError extends Error {
  constructor(
    readonly reason: CaixaUnreachableReason,
    readonly status?: number,
  ) {
    super(
      `Caixa could not be reached: ${reason}${status === undefined ? '' : ` (HTTP ${status})`}`,
    );
    this.name = 'CaixaUnreachableError';
  }
}

/**
 * A URL that is not on Caixa's own site was handed to the port. URLs come from Caixa's data, which
 * is untrusted: the port never sends a request elsewhere (and never sends our identity there).
 */
export class CaixaUrlRefusedError extends Error {
  constructor() {
    super('The URL is not on the Caixa site');
    this.name = 'CaixaUrlRefusedError';
  }
}
