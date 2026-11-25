/**
 * The identity the product presents to Caixa on plain HTTP requests (SC-24): its own name, never
 * a browser's. Caixa is collected politely and undisguised, so this is what a Caixa operator
 * reading their access log sees. HttpCaixaAccess (auctions/caixa/) sends it on every request it
 * makes, and so do the storage copies of Caixa's images and matrículas. The detail-page scraper
 * drives plain puppeteer and sends the browser's own default, not an impersonation.
 */
export const CAIXA_USER_AGENT = 'FarolDosLeiloes/1.0';
