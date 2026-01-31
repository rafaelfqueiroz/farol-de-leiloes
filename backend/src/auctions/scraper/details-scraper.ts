import * as cheerio from 'cheerio';
import { PaymentMethod, ExpenseRule } from '../schemas/auction.schema';

export interface ScrapedPhaseDetails {
  paymentMethods?: PaymentMethod[];
  expenseRules?: ExpenseRule[];
  phaseDates?: Date[];
}

export interface ScrapedDetails {
  imageUrl?: string;
  description?: string;
  phaseDetails?: ScrapedPhaseDetails;
}

/**
 * Scrapes auction details from Caixa website
 * @param html HTML content from the details page
 * @returns Scraped details including image URL
 */
export function scrapeAuctionDetails(html: string): ScrapedDetails {
  const $ = cheerio.load(html);
  const details: ScrapedDetails = {};

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
    const descriptionMatch = relatedBoxHtml.match(/<strong>Descrição:<\/strong><br\s*\/?>([\s\S]*?)<\/p>/i);
    if (descriptionMatch) {
      details.description = descriptionMatch[1]
        .replace(/&nbsp;/g, ' ')
        .replace(/<[^>]*>/g, '')
        .trim();
    }

    // Extract payment methods, expense rules, and phase dates
    details.phaseDetails = extractPhaseDetails(relatedBoxHtml, $);
  }

  return details;
}

/**
 * Extracts payment methods from the related-box HTML
 * Looks for "FORMAS DE PAGAMENTO ACEITAS:" section
 */
function extractPaymentMethods(html: string): PaymentMethod[] {
  const paymentMethods: PaymentMethod[] = [];

  // Find the section starting with "FORMAS DE PAGAMENTO ACEITAS:"
  const paymentSectionMatch = html.match(/FORMAS DE PAGAMENTO ACEITAS:<br\s*\/?>([\s\S]*?)(?:REGRAS PARA PAGAMENTO|<\/p>)/i);
  if (!paymentSectionMatch) return paymentMethods;

  const paymentSection = paymentSectionMatch[1];

  // Extract each payment method from <i> tags followed by text
  // Format: <i class="fa fa-info-circle"></i>&nbsp;Recursos próprios.<br>
  const methodMatches = paymentSection.matchAll(/<i[^>]*><\/i>&nbsp;([^<]+)/gi);
  for (const match of methodMatches) {
    const methodText = match[1].toLowerCase().trim();

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
  const expenseSectionMatch = html.match(/REGRAS PARA PAGAMENTO DAS DESPESAS[^:]*:<br\s*\/?>([\s\S]*?)(?:<span|<\/p>|$)/i);
  if (!expenseSectionMatch) return expenseRules;

  const expenseSection = expenseSectionMatch[1];

  // Extract each expense rule from <i> tags followed by text
  // Format: <i class="fa fa-info-circle"></i>&nbsp;Condomínio: Sob responsabilidade do comprador...<br>
  const ruleMatches = expenseSection.matchAll(/<i[^>]*><\/i>&nbsp;([^<]+)/gi);
  for (const match of ruleMatches) {
    const ruleText = match[1].trim();

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
 * Parses a date string in Brazilian format "DD/MM/YYYY - HHhMM" to a Date object
 * Example: "26/01/2026 - 10h00" -> Date
 */
function parseBrazilianDate(dateStr: string): Date | null {
  // Match pattern: DD/MM/YYYY - HHhMM
  const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})\s*-\s*(\d{1,2})h(\d{2})/);
  if (!match) return null;

  const [, day, month, year, hours, minutes] = match;
  // Create date in Brazil timezone (UTC-3)
  const date = new Date(
    parseInt(year),
    parseInt(month) - 1, // Month is 0-indexed
    parseInt(day),
    parseInt(hours),
    parseInt(minutes),
  );
  return date;
}

/**
 * Extracts phase dates from the related-box HTML
 * Handles three different auction types:
 * 1. SFI Auction: "Data do 1º Leilão - DD/MM/YYYY - HHhMM" and "Data do 2º Leilão - DD/MM/YYYY - HHhMM"
 * 2. Open Bidding: "Data da Licitação Aberta - DD/MM/YYYY - HHhMM"
 * 3. Online Sales: Countdown timer in div#divContador (calculates end date from remaining time)
 * 4. Direct Online Sales: No end date (returns empty array)
 */
function extractPhaseDates(html: string, $: cheerio.CheerioAPI): Date[] {
  const phaseDates: Date[] = [];

  // Try SFI Auction pattern - "Data do 1º Leilão" and "Data do 2º Leilão"
  const firstAuctionMatch = html.match(/Data do 1º Leilão\s*-\s*(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{1,2}h\d{2})/i);
  const secondAuctionMatch = html.match(/Data do 2º Leilão\s*-\s*(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{1,2}h\d{2})/i);

  if (firstAuctionMatch) {
    const date = parseBrazilianDate(firstAuctionMatch[1]);
    if (date) phaseDates.push(date);
  }
  if (secondAuctionMatch) {
    const date = parseBrazilianDate(secondAuctionMatch[1]);
    if (date) phaseDates.push(date);
  }

  if (phaseDates.length > 0) {
    return phaseDates;
  }

  // Try Open Bidding pattern - "Data da Licitação Aberta"
  const openBiddingMatch = html.match(/Data da Licitação Aberta\s*-\s*(\d{2}\/\d{2}\/\d{4}\s*-\s*\d{1,2}h\d{2})/i);
  if (openBiddingMatch) {
    const date = parseBrazilianDate(openBiddingMatch[1]);
    if (date) phaseDates.push(date);
    return phaseDates;
  }

  // Try Online Sales pattern - countdown timer in div#divContador
  const countdownDiv = $('#divContador');
  if (countdownDiv.length > 0) {
    // Check if it's "Venda Online" (has countdown) vs "Venda Direta Online" (no end date)
    const countdownHtml = countdownDiv.html() || '';
    if (countdownHtml.includes('Venda Online') && !countdownHtml.includes('Venda Direta')) {
      // Extract days, hours, minutes, seconds from the countdown
      const daysEl = $('#dias0');
      const hoursEl = $('#horas0');
      const minutesEl = $('#minutos0');
      const secondsEl = $('#segundos0');

      if (daysEl.length > 0) {
        const days = parseInt(daysEl.text().trim()) || 0;
        const hours = parseInt(hoursEl.text().trim()) || 0;
        const minutes = parseInt(minutesEl.text().trim()) || 0;
        const seconds = parseInt(secondsEl.text().trim()) || 0;

        // Calculate end date from now + remaining time
        const now = new Date();
        const endDate = new Date(
          now.getTime() +
            days * 24 * 60 * 60 * 1000 +
            hours * 60 * 60 * 1000 +
            minutes * 60 * 1000 +
            seconds * 1000,
        );
        phaseDates.push(endDate);
      }
    }
    // Direct Online Sales ("Venda Direta Online") - no end date, returns empty array
  }

  return phaseDates;
}

/**
 * Extracts phase-specific details (payment methods, expense rules, and phase dates)
 */
function extractPhaseDetails(html: string, $: cheerio.CheerioAPI): ScrapedPhaseDetails {
  return {
    paymentMethods: extractPaymentMethods(html),
    expenseRules: extractExpenseRules(html),
    phaseDates: extractPhaseDates(html, $),
  };
}

/**
 * Fetches and scrapes auction details from the Caixa website
 * @param detailsUrl URL of the auction details page
 * @returns Scraped details
 */
export async function fetchAndScrapeDetails(detailsUrl: string): Promise<ScrapedDetails> {
  try {
    const response = await fetch(detailsUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const html = await response.text();
    return scrapeAuctionDetails(html);
  } catch (error) {
    console.error(`Error scraping details from ${detailsUrl}:`, error);
    return {};
  }
}
