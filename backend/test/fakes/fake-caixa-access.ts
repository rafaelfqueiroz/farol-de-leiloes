import {
  CaixaAccess,
  type CaixaFile,
  CaixaUnreachableError,
} from '../../src/auctions/caixa/caixa-access.js';

type Answer<T> = T | Error;

function answer<T>(value: Answer<T>): T {
  if (value instanceof Error) throw value;
  return value;
}

/**
 * TS-03 / TS-07: a hand-written fake of the CaixaAccess port. Nothing leaves the process: each
 * request is answered with what the spec set (a value, or an Error to throw, such as
 * `new CaixaBlockedError('HTTP_403')`) and recorded in `requests`.
 *
 *   const caixa = new FakeCaixaAccess().serveList(readCaixaFixture('Lista_imoveis_geral.csv'));
 *   caixa.serveDetailPage(url, html);
 */
export class FakeCaixaAccess extends CaixaAccess {
  readonly requests: { kind: 'list' | 'detail' | 'file'; url?: string }[] = [];
  private list: Answer<string> | undefined;
  private readonly detailPages = new Map<string, Answer<string>>();
  private readonly files = new Map<string, Answer<CaixaFile>>();

  /** Forgets every answer and every request (a spec that reuses one fake across its cases). */
  reset(): this {
    this.requests.length = 0;
    this.list = undefined;
    this.detailPages.clear();
    this.files.clear();
    return this;
  }

  serveList(listOrError: Answer<string>): this {
    this.list = listOrError;
    return this;
  }

  serveDetailPage(url: string, htmlOrError: Answer<string>): this {
    this.detailPages.set(url, htmlOrError);
    return this;
  }

  serveFile(url: string, fileOrError: Answer<CaixaFile>): this {
    this.files.set(url, fileOrError);
    return this;
  }

  downloadList(): Promise<string> {
    this.requests.push({ kind: 'list' });
    return this.reply(() => (this.list === undefined ? this.nothingServed() : answer(this.list)));
  }

  fetchDetailPage(url: string): Promise<string> {
    this.requests.push({ kind: 'detail', url });
    return this.reply(() => {
      const served = this.detailPages.get(url);
      return served === undefined ? this.nothingServed() : answer(served);
    });
  }

  fetchFile(url: string): Promise<CaixaFile> {
    this.requests.push({ kind: 'file', url });
    return this.reply(() => {
      const served = this.files.get(url);
      return served === undefined ? this.nothingServed() : answer(served);
    });
  }

  private reply<T>(produce: () => T): Promise<T> {
    try {
      return Promise.resolve(produce());
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error('FakeCaixaAccess failed'));
    }
  }

  /** What an unset answer is: as a page Caixa does not have. */
  private nothingServed(): never {
    throw new CaixaUnreachableError('HTTP_STATUS', 404);
  }
}
