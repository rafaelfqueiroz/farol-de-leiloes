// The default CaixaAccess adapter (AR-10): plain HTTP with Node's fetch (undici), no browser, no
// shell. It is polite and undisguised (SC-24, SPEC-004 BR-004-18, BR-004-20): the product's own
// user agent, a timeout and a size cap on every request, and it STOPS on any block signal (403,
// 429, a challenge page, a redirect off the site) with CaixaBlockedError. It never retries, never
// switches address, never answers a challenge. The one way out of the VPS's own address is the
// optional CAIXA_PROXY_URL (ADR-003, #108); an http(s) proxy only.
import { Logger, OnModuleDestroy } from '@nestjs/common';
import { type Dispatcher, ProxyAgent, fetch } from 'undici';
import { CAIXA_ORIGIN, resolveOnCaixaSite } from '../../common/caixa-site.js';
import { CAIXA_USER_AGENT } from '../../common/caixa-user-agent.js';
import type { CaixaConfig } from '../../config/caixa.config.js';
import { isBotProtectionPage } from './bot-protection.js';
import {
  CaixaAccess,
  CaixaBlockedError,
  type CaixaBlockReason,
  type CaixaFile,
  CaixaUnreachableError,
  CaixaUrlRefusedError,
} from './caixa-access.js';

/** The national list, all states: `Lista_imoveis_geral.csv`. */
export const CAIXA_LIST_PATH = '/listaweb/Lista_imoveis_geral.csv';

const MAX_REDIRECTS = 3;
/** Statuses that are Caixa (or the proxy, or the law) saying no: stop, as for a challenge. */
const BLOCK_STATUS: Readonly<Record<number, CaixaBlockReason>> = {
  401: 'HTTP_401',
  403: 'HTTP_403',
  407: 'HTTP_407',
  429: 'HTTP_429',
  451: 'HTTP_451',
};
/** A 5xx body is read only far enough to see whether it is a challenge page. */
const ERROR_BODY_PROBE_BYTES = 64 * 1024;
/** Caixa's pages and list are Windows-1252; a browser would assume it too when nothing says else. */
const DEFAULT_CHARSET = 'windows-1252';

interface RawResponse {
  body: Buffer;
  contentType: string | null;
}

export class HttpCaixaAccess extends CaixaAccess implements OnModuleDestroy {
  private readonly origin: URL;
  private readonly proxy: ProxyAgent | undefined;

  /** `origin` is Caixa's site; only a spec points it elsewhere (a local server). */
  constructor(
    private readonly config: CaixaConfig,
    origin: string = CAIXA_ORIGIN,
  ) {
    super();
    this.origin = new URL(origin);
    this.proxy = config.proxyUrl === undefined ? undefined : new ProxyAgent(config.proxyUrl);
    if (this.proxy) {
      // SC-24: a proxy is a transport decision (ADR-003, #108), never an answer to a block. Said
      // once at boot, without the URL (it may carry credentials, SC-16).
      new Logger(HttpCaixaAccess.name).warn(
        'CAIXA_PROXY_URL is set: Caixa traffic leaves through a proxy. Do not add or change it because Caixa blocked a request (SC-24, ADR-003)',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.proxy?.close();
  }

  async downloadList(): Promise<string> {
    const response = await this.get(new URL(CAIXA_LIST_PATH, this.origin), 'text/csv,*/*;q=0.5');
    return this.decodeText(response);
  }

  async fetchDetailPage(url: string): Promise<string> {
    const response = await this.get(this.onSite(url), 'text/html,*/*;q=0.5');
    return this.decodeText(response);
  }

  async fetchFile(url: string): Promise<CaixaFile> {
    const response = await this.get(this.onSite(url), '*/*');
    // A challenge page can stand where a PDF or a photo should be.
    if (this.isHtml(response)) this.refuseChallenge(this.decodeText(response));
    return response;
  }

  /** SC-24 / SC-19: Caixa's data holds the URLs; a request only ever goes to Caixa's own site. */
  private onSite(rawUrl: string): URL {
    const url = resolveOnCaixaSite(rawUrl, this.origin);
    if (!url) throw new CaixaUrlRefusedError();
    return url;
  }

  private async get(first: URL, accept: string): Promise<RawResponse> {
    let url = first;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const response = await this.request(url, accept);
      const status = response.status;
      if (status >= 300 && status < 400) {
        const location = response.headers.get('location');
        await response.body?.cancel();
        const next = location ? this.resolveRedirect(location, url) : null;
        // A missing or malformed Location is an unexpected answer, not a crash.
        if (!next) throw new CaixaUnreachableError('HTTP_STATUS', status);
        // A redirect away from the site is how a challenge usually arrives.
        if (next.origin !== this.origin.origin) throw new CaixaBlockedError('REDIRECT_OFF_SITE');
        url = next;
        continue;
      }
      const blocked = BLOCK_STATUS[status];
      if (blocked) {
        await response.body?.cancel();
        throw new CaixaBlockedError(blocked);
      }
      if (status >= 500) await this.refuseServerErrorPage(response);
      if (status < 200 || status >= 300) {
        await response.body?.cancel();
        throw new CaixaUnreachableError('HTTP_STATUS', status);
      }
      return {
        body: await this.readBody(response),
        contentType: response.headers.get('content-type'),
      };
    }
    throw new CaixaUnreachableError('TOO_MANY_REDIRECTS');
  }

  private resolveRedirect(location: string, from: URL): URL | null {
    try {
      return new URL(location, from);
    } catch {
      return null;
    }
  }

  /**
   * Radware can answer a challenge with a 5xx. Reads at most ERROR_BODY_PROBE_BYTES of the body to
   * tell: a challenge is a block, anything else stays an unreachable 5xx (the caller throws it).
   */
  private async refuseServerErrorPage(response: Awaited<ReturnType<typeof fetch>>): Promise<void> {
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of response.body ?? []) {
        const bytes = Buffer.from(chunk as Uint8Array);
        chunks.push(bytes.subarray(0, ERROR_BODY_PROBE_BYTES - size));
        size += bytes.length;
        if (size >= ERROR_BODY_PROBE_BYTES) break; // leaving the loop cancels the stream
      }
    } catch {
      return; // the status alone decides: an unreachable 5xx
    }
    const text = decodeBody(Buffer.concat(chunks), response.headers.get('content-type'));
    this.refuseChallenge(text);
  }

  private async request(url: URL, accept: string) {
    try {
      return await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        // The product's own name, never a browser's (SC-24).
        headers: { 'User-Agent': CAIXA_USER_AGENT, Accept: accept },
        signal: AbortSignal.timeout(this.config.requestTimeoutMs),
        ...(this.proxy ? { dispatcher: this.proxy as Dispatcher } : {}),
      });
    } catch (error) {
      throw this.unreachable(error);
    }
  }

  /** Reads the body up to the size cap; the same timeout signal still bounds the read. */
  private async readBody(response: Awaited<ReturnType<typeof fetch>>): Promise<Buffer> {
    const max = this.config.maxDownloadBytes;
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > max) {
      await response.body?.cancel();
      throw new CaixaUnreachableError('RESPONSE_TOO_LARGE');
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    try {
      for await (const chunk of response.body ?? []) {
        const bytes = Buffer.from(chunk as Uint8Array);
        size += bytes.length;
        if (size > max) {
          tooLarge = true;
          break; // leaving the loop cancels the stream
        }
        chunks.push(bytes);
      }
    } catch (error) {
      throw this.unreachable(error);
    }
    if (tooLarge) throw new CaixaUnreachableError('RESPONSE_TOO_LARGE');
    return Buffer.concat(chunks, size);
  }

  /** A transport failure as a typed error. Its message is dropped: it can quote a URL or a proxy. */
  private unreachable(error: unknown): CaixaUnreachableError {
    const name = error instanceof Error ? error.name : '';
    return new CaixaUnreachableError(
      name === 'TimeoutError' || name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
    );
  }

  private isHtml(response: RawResponse): boolean {
    return /html/i.test(response.contentType ?? '');
  }

  private refuseChallenge(text: string): void {
    if (isBotProtectionPage(text)) throw new CaixaBlockedError('CHALLENGE_PAGE');
  }

  /** The text of a response; a challenge page is refused instead of handed on to be parsed. */
  private decodeText(response: RawResponse): string {
    const text = decodeBody(response.body, response.contentType);
    // The list is CSV, never markup: only a body that looks like a page is parsed for a challenge.
    if (this.isHtml(response) || text.trimStart().startsWith('<')) this.refuseChallenge(text);
    return text;
  }
}

/** The charset a Content-Type header or an early `<meta>` names, else Windows-1252. */
function decodeBody(body: Buffer, contentType: string | null): string {
  const declared =
    /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1] ??
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(body.subarray(0, 2048).toString('latin1'))?.[1];
  return textDecoder(declared).decode(body);
}

function textDecoder(label: string | undefined): TextDecoder {
  try {
    return new TextDecoder(label ?? DEFAULT_CHARSET);
  } catch {
    // A label the runtime does not know.
    return new TextDecoder(DEFAULT_CHARSET);
  }
}
