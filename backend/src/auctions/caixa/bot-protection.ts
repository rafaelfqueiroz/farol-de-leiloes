import * as cheerio from 'cheerio';

/** How much of a body is looked at: the first 256 KiB. */
const PROBE_CHARS = 256 * 1024;

// Host of the Radware bot-protection CDN. Compared exactly, never as a substring (SC-19).
const RADWARE_CDN_HOST = 'cdn.perfdrive.com';

/** True when a URL-valued attribute points at the Radware CDN over http(s). */
function loadsFromRadwareCdn(rawUrl: string): boolean {
  try {
    // The base makes a protocol-relative URL ("//host/x") parse; a relative one lands on Caixa.
    const url = new URL(rawUrl.trim(), 'https://venda-imoveis.caixa.gov.br');
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname === RADWARE_CDN_HOST
    );
  } catch {
    return false;
  }
}

/**
 * Recognises the Radware / ShieldSquare challenge page served in place of what was asked for
 * (BR-004-20). Reading it is how the product knows to STOP; nothing here answers the challenge.
 * SC-19 / CodeQL js/incomplete-url-substring-sanitization: the CDN is recognised by the parsed
 * host of a resource the page loads, so a look-alike host or the name in a query string or in
 * text does not count.
 */
export function isBotProtectionPage(page: string): boolean {
  // The challenge announces itself at the top; never parse more than this of an 8 MB body.
  const html = page.length > PROBE_CHARS ? page.slice(0, PROBE_CHARS) : page;
  if (html.includes('Radware Bot Manager') || html.includes('ShieldSquare')) return true;

  const $ = cheerio.load(html);
  return $('[src], [href]')
    .toArray()
    .some((el) => {
      const node = $(el);
      return [node.attr('src'), node.attr('href')].some(
        (value) => value !== undefined && loadsFromRadwareCdn(value),
      );
    });
}
