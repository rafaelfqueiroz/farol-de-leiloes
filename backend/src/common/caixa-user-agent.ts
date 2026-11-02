/**
 * The identity the product presents to Caixa on plain HTTP requests (SC-24): its own name, never
 * a browser's. Caixa is collected politely and undisguised, so this is what a Caixa operator
 * reading their access log sees. The detail-page scraper drives plain puppeteer and sends the
 * browser's own default, not an impersonation; the list download in `downloader.ts` still
 * spoofs one and moves here with #4.
 */
export const CAIXA_USER_AGENT = 'FarolDosLeiloes/1.0';
