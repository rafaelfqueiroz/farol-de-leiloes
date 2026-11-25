// SC-24 / SC-19: Caixa's data holds URLs (the list's link, the scraped photo and document paths)
// and that data is untrusted. A request goes only to Caixa's own site: https, the same origin,
// no credentials in the URL. One rule, shared by the port, the detail scraper and the storage
// copies.
import { describe, expect, it } from 'vitest';
import { CAIXA_ORIGIN, resolveOnCaixaSite } from './caixa-site.js';

describe('resolveOnCaixaSite', () => {
  it.each([
    ['https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1'],
    ['https://VENDA-IMOVEIS.caixa.gov.br/fotos/F1.jpg'],
    ['https://venda-imoveis.caixa.gov.br:443/fotos/F1.jpg'],
    ['/fotos/F1.jpg'],
    ['  /editais/matricula/TO/1.pdf  '],
    ['fotos/F1.jpg'],
  ])('resolves %s on the site', (raw) => {
    const url = resolveOnCaixaSite(raw);

    expect(url).not.toBeNull();
    expect(url?.origin).toBe(CAIXA_ORIGIN);
    expect(url?.protocol).toBe('https:');
  });

  it.each([
    ['userinfo', 'https://user:secret@venda-imoveis.caixa.gov.br/fotos/F1.jpg'],
    ['username only', 'https://user@venda-imoveis.caixa.gov.br/fotos/F1.jpg'],
    ['look-alike suffix host', 'https://venda-imoveis.caixa.gov.br.evil.example/fotos/F1.jpg'],
    ['look-alike prefix host', 'https://evilvenda-imoveis.caixa.gov.br/fotos/F1.jpg'],
    ['the site as userinfo of another host', 'https://venda-imoveis.caixa.gov.br@evil.example/x'],
    ['an @evil host', 'https://@evil.example/x'],
    ['another port', 'https://venda-imoveis.caixa.gov.br:8443/fotos/F1.jpg'],
    ['the backslash form', 'https://evil.example\\@venda-imoveis.caixa.gov.br/x'],
    ['a backslash path to another host', 'https:\\\\evil.example\\x'],
    ['an http downgrade', 'http://venda-imoveis.caixa.gov.br/fotos/F1.jpg'],
    ['a protocol-relative URL to another host', '//evil.example/x'],
    ['another host', 'https://example.com/x'],
    ['the cloud metadata address', 'http://169.254.169.254/latest/meta-data'],
    ['a file URL', 'file:///etc/passwd'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['an unparseable URL', 'http://[::1'],
    ['an empty string', ''],
  ])('refuses %s', (_name, raw) => {
    expect(resolveOnCaixaSite(raw)).toBeNull();
  });

  it('judges against another origin when told (the specs point the adapter at a local server)', () => {
    const local = new URL('http://127.0.0.1:4010');

    expect(resolveOnCaixaSite('/x', local)?.href).toBe('http://127.0.0.1:4010/x');
    expect(resolveOnCaixaSite('http://127.0.0.1:4011/x', local)).toBeNull();
    expect(resolveOnCaixaSite('http://u:p@127.0.0.1:4010/x', local)).toBeNull();
  });
});
