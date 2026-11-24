// SPEC-004 BR-004-11, BR-004-12, BR-004-15, BR-004-20: what a Caixa detail page says. Pure: HTML in,
// data out. The page is UNTRUSTED (SC-24, SC-19): it is parsed with cheerio, never rendered, every
// link it holds is resolved onto Caixa's own site before it is kept, and no text of it is ever
// logged (a matrícula's page can name people, SC-15). The fetching is `CaixaAccess` (AR-10): nothing
// here reaches the network.
import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
import { brasiliaWallClockToInstant } from '../../common/clock/brasilia-time.js';
import { resolveOnCaixaSite } from '../../common/caixa-site.js';
import { isBotProtectionPage } from '../caixa/bot-protection.js';
import {
  type DetailPage,
  type ExpenseRule,
  type Occupancy,
  PaymentMethod,
  type RoundPrices,
} from '../domain/detail-data.js';
import { parseCaixaMoney } from '../importer/parser.js';

/**
 * What reading a page gave. Only `page` carries data; the other three are WHY there is none:
 *  - `blocked`: Caixa's challenge page stands where the property should be (BR-004-20): never
 *    parsed, the whole collection stops;
 *  - `unavailable`: the page says the property is no longer for sale. The LIST decides availability
 *    (BR-004-08), so this is no verdict: the property is neither hidden nor marked here;
 *  - `unrecognised`: not a page this reader understands (a layout change, an error page): a failed
 *    fetch of that one property (BR-004-21).
 */
export type ScrapeResult =
  | { kind: 'blocked' }
  | { kind: 'unavailable' }
  | { kind: 'unrecognised' }
  | { kind: 'page'; page: DetailPage };

/** The photo links kept from a gallery: a sanity bound against a hostile page, not the copy cap. */
const MAX_GALLERY_LINKS = 100;

const UNAVAILABLE_TEXT = 'O imóvel que você procura não está mais disponível para venda';

/** The text of an element, whitespace (NBSP included) collapsed. */
function squash(text: string): string {
  return text.replace(/[\s\u00a0]+/g, ' ').trim();
}

/** Reads one detail page (BR-004-11). Never throws for a page's content. */
export function scrapeAuctionDetails(html: string): ScrapeResult {
  if (isBotProtectionPage(html)) return { kind: 'blocked' };

  const $ = cheerio.load(html);
  if ($('body').text().includes(UNAVAILABLE_TEXT)) return { kind: 'unavailable' };

  const relatedBox = $('.related-box');
  if (relatedBox.length === 0 && $('#dadosImovel').length === 0) return { kind: 'unrecognised' };
  const relatedBoxHtml = relatedBox.html() ?? '';
  // Entity-decoded, whitespace-collapsed text of the whole page: where a label and its value are
  // read from (a commented-out line, like Caixa's hidden "Situação", is not text).
  const text = squash($('body').text());

  return {
    kind: 'page',
    page: {
      description: extractDescription($, relatedBox),
      propertyType: labelledValue($, 'Tipo de imóvel'),
      occupancy: occupancyOf(labelledValue($, 'Situação')),
      phaseDates: extractPhaseDates(html),
      prices: extractPrices(text),
      paymentMethods: extractPaymentMethods(relatedBoxHtml),
      expenseRules: extractExpenseRules(relatedBoxHtml),
      photoUrls: extractPhotoUrls($),
      matriculaUrl: documentUrl(html, /ExibeDoc\(['"](\/editais\/matricula\/[^'"]+)['"]\)/i),
      editalUrl: documentUrl(html, /ExibeDoc\(['"](\/editais\/[A-Z0-9]+\.PDF)['"]\)/i),
      editalPublishedAt: extractEditalPublishedAt(text),
    },
  };
}

/** "Tipo de imóvel: <strong>Apartamento </strong>" -> "Apartamento"; null when absent or empty. */
function labelledValue($: CheerioAPI, label: string): string | null {
  const span = $('span')
    .filter((_, el) => {
      // The label is the span's own text; the value sits in a <strong> child.
      const own = $(el)
        .contents()
        .filter((__, node) => node.type === 'text')
        .text();
      return squash(own) === `${label}:`;
    })
    .first();
  const value = squash(span.children('strong').first().text());
  return value === '' ? null : value;
}

/** BR-004-15: only the two words Caixa uses give an answer; anything else is unknown. */
function occupancyOf(value: string | null): Occupancy | null {
  const word = (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  if (word === 'ocupado') return 'OCCUPIED';
  if (word === 'desocupado') return 'UNOCCUPIED';
  return null;
}

/**
 * Extracts the "Descrição:" paragraph of the related-box as plain text, or null when the page has
 * none. The text is what the browser would show: tags are never matched by pattern.
 */
function extractDescription($: CheerioAPI, relatedBox: ReturnType<CheerioAPI>): string | null {
  const label = relatedBox
    .find('strong')
    .filter((_, el) => $(el).text().trim() === 'Descrição:')
    .first();
  const paragraph = label.parent('p').clone();
  if (paragraph.length === 0) return null;

  // SC-19: the description is what follows the label and the <br> right after it. Stripping tags
  // with a regex leaves markup behind when the input nests one tag inside another (CodeQL
  // js/incomplete-multi-character-sanitization), so it is read as text from the parsed DOM.
  paragraph.find('strong').first().remove();
  paragraph.find('br').first().remove();
  // Kept entity-encoded (&, < and > stay "&amp;", "&lt;", "&gt;"), so text that only looks like a
  // tag after parsing is stored inert.
  return paragraph
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}

/**
 * BR-004-11: the minimum sale prices the page states. An SFI auction has "Valor mínimo de venda 1º
 * Leilão: R$ …" and "… 2º Leilão: R$ …"; the other modalities one "Valor mínimo de venda: R$ …".
 * An amount that is not a pt-BR amount is null (AR-17), never a guess.
 */
function extractPrices(text: string): RoundPrices {
  const amount = (pattern: RegExp) => {
    const cell = pattern.exec(text)?.[1];
    return cell === undefined ? null : parseCaixaMoney(cell);
  };
  return {
    first: amount(/Valor mínimo de venda\s*1º\s*Leilão:\s*R\$\s*([\d.,]+)/i),
    second: amount(/Valor mínimo de venda\s*2º\s*Leilão:\s*R\$\s*([\d.,]+)/i),
    single: amount(/Valor mínimo de venda:\s*R\$\s*([\d.,]+)/i),
  };
}

/**
 * The gallery: every thumbnail, else the preview, as links on Caixa's own site (SC-24), in page
 * order and without repeats.
 */
function extractPhotoUrls($: CheerioAPI): string[] {
  const sources = $('.thumbnails img')
    .map((_, el) => $(el).attr('src'))
    .get();
  const preview = $('#preview').attr('src');
  const raw = sources.length > 0 ? sources : preview === undefined ? [] : [preview];
  const urls: string[] = [];
  for (const source of raw) {
    const url = resolveOnCaixaSite(source);
    if (url === null || url.protocol !== 'https:') continue;
    if (!urls.includes(url.href)) urls.push(url.href);
    if (urls.length >= MAX_GALLERY_LINKS) break;
  }
  return urls;
}

/** The link a page's `ExibeDoc('...')` call names, resolved onto Caixa's site; null otherwise. */
function documentUrl(html: string, pattern: RegExp): string | null {
  const path = pattern.exec(html)?.[1];
  if (path === undefined) return null;
  return resolveOnCaixaSite(path)?.href ?? null;
}

/** "(Edital publicado em: 23/01/2026 11:58:46)" in Brasília local time (BR-004-12). */
function extractEditalPublishedAt(text: string): Date | null {
  const match = /Edital publicado em:\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/i.exec(
    text,
  );
  if (!match) return null;
  const [, day, month, year, hours, minutes, seconds] = match.map(Number);
  return brasiliaWallClockToInstant({
    year: year as number,
    month: month as number,
    day: day as number,
    hours: hours as number,
    minutes: minutes as number,
    seconds: seconds as number,
  });
}

/**
 * Extracts payment methods from the related-box HTML. Looks for the "FORMAS DE PAGAMENTO
 * ACEITAS:" section; null when the page has none or names no method this product knows (BR-004-15:
 * a page that does not say is unknown, never "no financing").
 */
function extractPaymentMethods(html: string): PaymentMethod[] | null {
  const section = html.match(
    /FORMAS DE PAGAMENTO ACEITAS:<br\s*\/?>([\s\S]*?)(?:REGRAS PARA PAGAMENTO|<\/p>)/i,
  )?.[1];
  if (section === undefined) return null;

  const methods: PaymentMethod[] = [];
  // Format: <i class="fa fa-info-circle"></i>&nbsp;Recursos próprios.<br>
  for (const [, rawText] of section.matchAll(/<i[^>]*><\/i>&nbsp;([^<]+)/gi)) {
    const text = (rawText ?? '').toLowerCase().trim();
    let method: PaymentMethod | null = null;
    if (text.includes('recursos próprios') || text.includes('recursos proprios')) {
      method = PaymentMethod.OWN_RESOURCES;
    } else if (text.includes('fgts')) {
      method = PaymentMethod.FGTS;
    } else if (text.includes('financiamento')) {
      method = PaymentMethod.FINANCING;
    }
    if (method !== null && !methods.includes(method)) methods.push(method);
  }
  return methods.length > 0 ? methods : null;
}

/**
 * Extracts expense rules from the related-box HTML: the "REGRAS PARA PAGAMENTO DAS DESPESAS"
 * section; null when the page has none or lists nothing.
 */
function extractExpenseRules(html: string): ExpenseRule[] | null {
  const section = html.match(
    /REGRAS PARA PAGAMENTO DAS DESPESAS[^:]*:<br\s*\/?>([\s\S]*?)(?:<span|<\/p>|$)/i,
  )?.[1];
  if (section === undefined) return null;

  const rules: ExpenseRule[] = [];
  // Format: <i class="fa fa-info-circle"></i>&nbsp;Condomínio: Sob responsabilidade do comprador.<br>
  for (const [, rawText] of section.matchAll(/<i[^>]*><\/i>&nbsp;([^<]+)/gi)) {
    const text = (rawText ?? '').trim();
    const colon = text.indexOf(':');
    if (colon > 0) {
      rules.push({
        type: text.substring(0, colon).trim(),
        description: text.substring(colon + 1).trim(),
      });
    } else if (text !== '') {
      rules.push({ type: 'Geral', description: text });
    }
  }
  return rules.length > 0 ? rules : null;
}

/**
 * "DD/MM/YYYY - HHhMM" as Brasília wall-clock time: "26/01/2026 - 10h00" is 13:00 UTC on any server
 * (AR-23, BR-004-12). A date that is not a real calendar day is refused, not rolled over.
 */
function parseBrazilianDate(text: string): Date | null {
  const match = /(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{1,2})h(\d{2})/.exec(text);
  if (!match) return null;
  const [, day, month, year, hours, minutes] = match.map(Number) as [
    unknown,
    number,
    number,
    number,
    number,
    number,
  ];
  return realBrasiliaInstant({ year, month, day, hours, minutes });
}

/** A Brasília wall clock as an instant, or null when it is not a real day and time. */
function realBrasiliaInstant(clock: {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  seconds?: number;
}): Date | null {
  const { month, day, hours, minutes, seconds = 0 } = clock;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (hours > 23 || minutes > 59 || seconds > 59) return null;
  const instant = brasiliaWallClockToInstant(clock);
  // Brasília is UTC-3 all year: 31 February would roll into March; the round trip catches it.
  const probe = new Date(Date.UTC(clock.year, month - 1, day));
  return probe.getUTCMonth() === month - 1 ? instant : null;
}

/**
 * Extracts the round end dates (BR-004-12) from the page. Handles four layouts:
 * 1. SFI auction: "Data do 1º Leilão - DD/MM/YYYY - HHhMM" and "Data do 2º Leilão - ..."
 * 2. Open bidding: "Data da Licitação Aberta - DD/MM/YYYY - HHhMM"
 * 3. Online sale: the countdown's `strLista: "1@@" + "DD/MM/YYYY HH:MM:SS"`
 * 4. Direct online sale: no end date (an empty list)
 */
function extractPhaseDates(html: string): Date[] {
  const dates: Date[] = [];
  for (const ordinal of ['1º', '2º']) {
    const written = new RegExp(
      `Data do ${ordinal} Leilão\\s*-\\s*(\\d{2}/\\d{2}/\\d{4}\\s*-\\s*\\d{1,2}h\\d{2})`,
      'i',
    ).exec(html)?.[1];
    const date = written === undefined ? null : parseBrazilianDate(written);
    if (date !== null) dates.push(date);
  }
  if (dates.length > 0) return dates;

  const open = /Data da Licitação Aberta\s*-\s*(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{1,2}h\d{2})/i.exec(
    html,
  )?.[1];
  if (open !== undefined) {
    const date = parseBrazilianDate(open);
    return date === null ? [] : [date];
  }

  // Direct online sales have an empty date string, so nothing matches.
  const countdown =
    /strLista:\s*"1@@"\s*\+\s*"(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})"/.exec(html);
  if (countdown) {
    const [, day, month, year, hours, minutes, seconds] = countdown.map(Number) as [
      unknown,
      number,
      number,
      number,
      number,
      number,
      number,
    ];
    const date = realBrasiliaInstant({ year, month, day, hours, minutes, seconds });
    if (date !== null) dates.push(date);
  }
  return dates;
}
