/**
 * The identity the product presents to Caixa on plain HTTP requests (SC-24): its own name, never
 * a browser's. Caixa is collected politely and undisguised, so this is what a Caixa operator
 * reading their access log sees. HttpCaixaAccess (auctions/caixa/) sends it on every request it
 * makes: the list, the detail pages and the files copied to R2 (SPEC-004 part 4 moved them all
 * behind the CaixaAccess port).
 */
export const CAIXA_USER_AGENT = 'FarolDosLeiloes/1.0';
