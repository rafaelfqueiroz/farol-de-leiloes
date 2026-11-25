// SC-24 / SC-19: where a request to Caixa may go. The URLs the product follows (the list's link,
// the photo and document paths scraped from a page) come from Caixa's data, which is untrusted,
// so a request goes only to Caixa's own site: the same origin (https, host and port) and no
// credentials in the URL. The one rule, used by the CaixaAccess port, the detail scraper and the
// storage copies, so none of them can be sent elsewhere (or leak our identity there) by a link.

/** Caixa's own site. */
export const CAIXA_ORIGIN = 'https://venda-imoveis.caixa.gov.br';
const CAIXA_ORIGIN_URL = new URL(CAIXA_ORIGIN);

/**
 * `raw` resolved against `origin` (default: Caixa's site, so a relative path lands on it), or null
 * when it is not on that origin or carries a user name or password. `origin` is another value
 * only in specs that point the adapter at a local server.
 *
 *   resolveOnCaixaSite('https://venda-imoveis.caixa.gov.br.evil.example/x') // null
 *   resolveOnCaixaSite('https://user:pw@venda-imoveis.caixa.gov.br/x')      // null
 *   resolveOnCaixaSite('/fotos/F1.jpg')                                     // on the site
 */
export function resolveOnCaixaSite(raw: string, origin: URL = CAIXA_ORIGIN_URL): URL | null {
  const text = raw.trim();
  if (text === '') return null;
  let url: URL;
  try {
    url = new URL(text, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin.origin) return null;
  if (url.username !== '' || url.password !== '') return null;
  return url;
}
