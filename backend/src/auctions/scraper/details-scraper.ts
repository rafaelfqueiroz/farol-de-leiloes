import * as cheerio from 'cheerio';
import type { CheerioAPI } from 'cheerio';
// SC-24: plain puppeteer, undisguised — no stealth plugin, no user-agent spoofing, no evasion
// flags. Puppeteer 25 is ESM-only, imported natively (#63).
import puppeteer from 'puppeteer';
import { PaymentMethod, ExpenseRule } from '../schemas/auction.schema.js';
import { brasiliaWallClockToInstant } from '../../common/clock/brasilia-time.js';

export interface ScrapedPhaseDetails {
  paymentMethods?: PaymentMethod[];
  expenseRules?: ExpenseRule[];
  phaseDates?: Date[];
}

export interface ScrapedDetails {
  imageUrl?: string;
  description?: string;
  phaseDetails?: ScrapedPhaseDetails;
  unavailable?: boolean;
  matriculaUrl?: string;
  editalUrl?: string;
}

/**
 * Scrapes auction details from Caixa website
 * @param html HTML content from the details page
 * @returns Scraped details including image URL
 */
export function scrapeAuctionDetails(html: string): ScrapedDetails {
  const $ = cheerio.load(html);
  const details: ScrapedDetails = {};

  // Check if the property is no longer available for sale
  const bodyText = $('body').text();
  if (bodyText.includes('O imóvel que você procura não está mais disponível para venda')) {
    return { unavailable: true };
  }

  // Extract image URL from the preview img tag
  // Example: <img id="preview" src="/fotos/F844440432017221.jpg" alt="Foto do imóvel">
  const previewImg = $('#preview');
  if (previewImg.length > 0) {
    const imgSrc = previewImg.attr('src');
    if (imgSrc) {
      // Convert relative URL to absolute URL
      const baseUrl = 'https://venda-imoveis.caixa.gov.br';
      details.imageUrl = imgSrc.startsWith('http') ? imgSrc : `${baseUrl}${imgSrc}`;
    }
  }

  // Extract data from the related-box div
  const relatedBox = $('.related-box');
  if (relatedBox.length > 0) {
    const relatedBoxHtml = relatedBox.html() || '';

    // Extract description
    // Format: <p style="margin-bottom: 0.5em;"><strong>Descrição:</strong><br>...</p>
    // SC-19: read as text from the parsed DOM. Stripping tags with a regex leaves markup behind
    // when the input nests one tag inside another (CodeQL js/incomplete-multi-character-sanitization).
    const description = extractDescription($, relatedBox);
    if (description !== undefined) {
      details.description = description;
    }

    // Extract payment methods, expense rules, and phase dates
    details.phaseDetails = extractPhaseDetails(relatedBoxHtml, html);
  }

  // Extract matrícula URL: ExibeDoc('/editais/matricula/{STATE}/{CODE}.pdf')
  const matriculaPath = html.match(/ExibeDoc\(['"](\/editais\/matricula\/[^'"]+)['"]\)/i)?.[1];
  if (matriculaPath) {
    details.matriculaUrl = `https://venda-imoveis.caixa.gov.br${matriculaPath}`;
  }

  // Extract edital URL: ExibeDoc('/editais/{CODE}.PDF')
  const editalPath = html.match(/ExibeDoc\(['"](\/editais\/[A-Z0-9]+\.PDF)['"]\)/i)?.[1];
  if (editalPath) {
    details.editalUrl = `https://venda-imoveis.caixa.gov.br${editalPath}`;
  }

  return details;
}

/**
 * Extracts the "Descrição:" paragraph of the related-box as plain text, or undefined when the
 * page has none. The text is what the browser would show: tags are never matched by pattern.
 */
function extractDescription($: CheerioAPI, relatedBox: ReturnType<CheerioAPI>): string | undefined {
  const label = relatedBox
    .find('strong')
    .filter((_, el) => $(el).text().trim() === 'Descrição:')
    .first();
  const paragraph = label.parent('p').clone();
  if (paragraph.length === 0) return undefined;

  // The description is what follows the label and the <br> right after it.
  paragraph.find('strong').first().remove();
  paragraph.find('br').first().remove();
  // Kept entity-encoded as before (&, < and > stay "&amp;", "&lt;", "&gt;"), so text that only
  // looks like a tag after parsing is stored inert.
  return paragraph
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .trim();
}

/**
 * Extracts payment methods from the related-box HTML
 * Looks for "FORMAS DE PAGAMENTO ACEITAS:" section
 */
function extractPaymentMethods(html: string): PaymentMethod[] {
  const paymentMethods: PaymentMethod[] = [];

  // Find the section starting with "FORMAS DE PAGAMENTO ACEITAS:"
  const paymentSection = html.match(
    /FORMAS DE PAGAMENTO ACEITAS:<br\s*\/?>([\s\S]*?)(?:REGRAS PARA PAGAMENTO|<\/p>)/i,
  )?.[1];
  if (paymentSection === undefined) return paymentMethods;

  // Extract each payment method from <i> tags followed by text
  // Format: <i class="fa fa-info-circle"></i>&nbsp;Recursos próprios.<br>
  const methodMatches = paymentSection.matchAll(/<i[^>]*><\/i>&nbsp;([^<]+)/gi);
  for (const [, rawMethodText] of methodMatches) {
    if (rawMethodText === undefined) continue;
    const methodText = rawMethodText.toLowerCase().trim();

    if (methodText.includes('recursos próprios') || methodText.includes('recursos proprios')) {
      paymentMethods.push(PaymentMethod.OWN_RESOURCES);
    } else if (methodText.includes('fgts')) {
      paymentMethods.push(PaymentMethod.FGTS);
    } else if (methodText.includes('financiamento')) {
      paymentMethods.push(PaymentMethod.FINANCING);
    }
  }

  return paymentMethods;
}

/**
 * Extracts expense rules from the related-box HTML
 * Looks for "REGRAS PARA PAGAMENTO DAS DESPESAS" section
 */
function extractExpenseRules(html: string): ExpenseRule[] {
  const expenseRules: ExpenseRule[] = [];

  // Find the section starting with "REGRAS PARA PAGAMENTO DAS DESPESAS"
  const expenseSection = html.match(
    /REGRAS PARA PAGAMENTO DAS DESPESAS[^:]*:<br\s*\/?>([\s\S]*?)(?:<span|<\/p>|$)/i,
  )?.[1];
  if (expenseSection === undefined) return expenseRules;

  // Extract each expense rule from <i> tags followed by text
  // Format: <i class="fa fa-info-circle"></i>&nbsp;Condomínio: Sob responsabilidade do comprador...<br>
  const ruleMatches = expenseSection.matchAll(/<i[^>]*><\/i>&nbsp;([^<]+)/gi);
  for (const [, rawRuleText] of ruleMatches) {
    if (rawRuleText === undefined) continue;
    const ruleText = rawRuleText.trim();

    // Parse rule type and description
    // Format: "Condomínio: Sob responsabilidade do comprador..."
    const colonIndex = ruleText.indexOf(':');
    if (colonIndex > 0) {
      const type = ruleText.substring(0, colonIndex).trim();
      const description = ruleText.substring(colonIndex + 1).trim();
      expenseRules.push({ type, description });
    } else {
      // If no colon, use the whole text as description with 'Geral' as type
      expenseRules.push({ type: 'Geral', description: ruleText });
    }
  }

  return expenseRules;
}

/**
 * Parses a date string in Brazilian format "DD/MM/YYYY - HHhMM" to a Date object.
 * Caixa's pages show Brasília wall-clock time, so "26/01/2026 - 10h00" is 13:00 UTC (AR-23).
 * It used to be built with `new Date(y, m, d, h, min)`, in the server's own zone: correct only
 * on a server set to Brasília, three hours off on one in UTC.
 */
function parseBrazilianDate(dateStr: string): Date | null {
  // Match pattern: DD/MM/YYYY - HHhMM
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{1,2})h(\d{2})/);
  if (!match) return null;

  const [, day, month, year, hours, minutes] = match;
  // Every group is mandatory, so this only narrows the types (DV-03).
  if (!day || !month || !year || !hours || !minutes) return null;
  return brasiliaWallClockToInstant({
    year: parseInt(year),
    month: parseInt(month),
    day: parseInt(day),
    hours: parseInt(hours),
    minutes: parseInt(minutes),
  });
}

/**
 * Extracts phase dates from the related-box HTML
 * Handles three different auction types:
 * 1. SFI Auction: "Data do 1º Leilão - DD/MM/YYYY - HHhMM" and "Data do 2º Leilão - DD/MM/YYYY - HHhMM"
 * 2. Open Bidding: "Data da Licitação Aberta - DD/MM/YYYY - HHhMM"
 * 3. Online Sales: Countdown timer in div#divContador (calculates end date from remaining time)
 * 4. Direct Online Sales: No end date (returns empty array)
 */
function extractPhaseDates(html: string): Date[] {
  const phaseDates: Date[] = [];

  // Try SFI Auction pattern - "Data do 1º Leilão" and "Data do 2º Leilão"
  const firstAuctionDate = html.match(
    /Data do 1º Leilão\s*-\s*(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{1,2}h\d{2})/i,
  )?.[1];
  const secondAuctionDate = html.match(
    /Data do 2º Leilão\s*-\s*(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{1,2}h\d{2})/i,
  )?.[1];

  if (firstAuctionDate) {
    const date = parseBrazilianDate(firstAuctionDate);
    if (date) phaseDates.push(date);
  }
  if (secondAuctionDate) {
    const date = parseBrazilianDate(secondAuctionDate);
    if (date) phaseDates.push(date);
  }

  if (phaseDates.length > 0) {
    return phaseDates;
  }

  // Try Open Bidding pattern - "Data da Licitação Aberta"
  const openBiddingDate = html.match(
    /Data da Licitação Aberta\s*-\s*(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{1,2}h\d{2})/i,
  )?.[1];
  if (openBiddingDate) {
    const date = parseBrazilianDate(openBiddingDate);
    if (date) phaseDates.push(date);
    return phaseDates;
  }

  // Try Online Sales pattern - extract date from strLista in carregaContador()
  // Format: strLista: "1@@" + "DD/MM/YYYY HH:MM:SS" + "@@" + "0,00" + "||"
  // Direct Online Sales has an empty date string, so no date is extracted
  const strListaMatch = html.match(
    /strLista:\s*"1@@"\s*\+\s*"(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})"/,
  );
  if (strListaMatch) {
    const [, day, month, year, hours, minutes, seconds] = strListaMatch;
    // Every group is mandatory, so this only narrows the types (DV-03).
    if (!day || !month || !year || !hours || !minutes || !seconds) return phaseDates;
    // Brasília wall-clock time, as above (AR-23).
    const date = brasiliaWallClockToInstant({
      year: parseInt(year),
      month: parseInt(month),
      day: parseInt(day),
      hours: parseInt(hours),
      minutes: parseInt(minutes),
      seconds: parseInt(seconds),
    });
    phaseDates.push(date);
  }

  return phaseDates;
}

/**
 * Extracts phase-specific details (payment methods, expense rules, and phase dates)
 */
function extractPhaseDetails(relatedBoxHtml: string, fullHtml: string): ScrapedPhaseDetails {
  return {
    paymentMethods: extractPaymentMethods(relatedBoxHtml),
    expenseRules: extractExpenseRules(relatedBoxHtml),
    phaseDates: extractPhaseDates(fullHtml),
  };
}

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
 * Recognises the Radware / ShieldSquare challenge page served in place of the auction page.
 * SC-19 / CodeQL js/incomplete-url-substring-sanitization: the CDN is recognised by the parsed
 * host of a resource the page loads, so a look-alike host or the name in a query string or in
 * text does not count.
 */
function isBotProtectionPage(html: string): boolean {
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

/**
 * Fetches the HTML content of an auction details page from Caixa website
 */
async function fetchAuctionDetailHtml(detailsUrl: string): Promise<string> {
  // The sandbox flags are needed to run Chrome as root in a container; they disguise nothing.
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    const response = await page.goto(detailsUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    if (!response) {
      throw new Error('No response received from navigation');
    }
    if (!response.ok()) {
      throw new Error(`HTTP error! status: ${response.status()}`);
    }
    const html = await page.content();

    if (isBotProtectionPage(html)) {
      throw new Error('Bot protection page detected instead of auction content');
    }

    return html;
  } finally {
    await browser.close();
  }
}

/**
 * Fetches and scrapes auction details from the Caixa website
 * @param detailsUrl URL of the auction details page
 * @returns Scraped details
 */
export async function fetchAndScrapeDetails(detailsUrl: string): Promise<ScrapedDetails> {
  try {
    const html = await fetchAuctionDetailHtml(detailsUrl);
    return scrapeAuctionDetails(html);
  } catch (error) {
    throw new Error(
      `Failed to scrape details from ${detailsUrl}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

/**
 * Lightweight availability check — fetches the page and only checks for the unavailable message.
 * No HTML parsing (cheerio, regex, etc.).
 * @returns true if available, false if unavailable
 */
export async function fetchAndCheckAvailability(detailsUrl: string): Promise<boolean> {
  const html = await fetchAuctionDetailHtml(detailsUrl);
  return !html.includes('O imóvel que você procura não está mais disponível para venda');
}
