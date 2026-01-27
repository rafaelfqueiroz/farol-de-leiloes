import * as cheerio from 'cheerio';
import { PaymentMethod, ExpenseRule } from '../schemas/auction.schema';

export interface ScrapedPhaseDetails {
  paymentMethods?: PaymentMethod[];
  expenseRules?: ExpenseRule[];
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

    // Extract payment methods and expense rules
    details.phaseDetails = extractPhaseDetails(relatedBoxHtml);
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
 * Extracts phase-specific details (payment methods and expense rules)
 */
function extractPhaseDetails(html: string): ScrapedPhaseDetails {
  return {
    paymentMethods: extractPaymentMethods(html),
    expenseRules: extractExpenseRules(html),
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
