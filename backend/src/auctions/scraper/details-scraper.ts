import * as cheerio from 'cheerio';

export interface ScrapedDetails {
  imageUrl?: string;
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

  return details;
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
