import { Injectable, Logger } from '@nestjs/common';
import { LlmAdapter } from '../adapters/llm.adapter';
import { MAX_PAGE_SIZE } from '../../common/pagination/pagination-query.dto';
import { Decimal, isMoneyString } from '../../common/money/money';

// State abbreviations mapping (full names → 2-letter codes)
const STATE_ABBREVIATIONS: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapá: 'AP',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceará: 'CE',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espírito santo': 'ES',
  'espirito santo': 'ES',
  goiás: 'GO',
  goias: 'GO',
  maranhão: 'MA',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  pará: 'PA',
  para: 'PA',
  paraíba: 'PB',
  paraiba: 'PB',
  paraná: 'PR',
  parana: 'PR',
  pernambuco: 'PE',
  piauí: 'PI',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondônia: 'RO',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'são paulo': 'SP',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
  // Also accept abbreviations directly
  ac: 'AC',
  al: 'AL',
  ap: 'AP',
  am: 'AM',
  ba: 'BA',
  ce: 'CE',
  df: 'DF',
  es: 'ES',
  go: 'GO',
  ma: 'MA',
  mt: 'MT',
  ms: 'MS',
  mg: 'MG',
  pa: 'PA',
  pb: 'PB',
  pr: 'PR',
  pe: 'PE',
  pi: 'PI',
  rj: 'RJ',
  rn: 'RN',
  rs: 'RS',
  ro: 'RO',
  rr: 'RR',
  sc: 'SC',
  sp: 'SP',
  se: 'SE',
  to: 'TO',
};

// Modality mappings (Portuguese → API values)
const MODALITY_MAPPINGS: Record<string, string> = {
  leilão: 'SFI_AUCTION',
  leilao: 'SFI_AUCTION',
  'leilão sfi': 'SFI_AUCTION',
  'leilao sfi': 'SFI_AUCTION',
  'edital único': 'SFI_AUCTION',
  'edital unico': 'SFI_AUCTION',
  'licitação aberta': 'OPEN_BIDDING',
  'licitacao aberta': 'OPEN_BIDDING',
  'venda direta online': 'DIRECT_ONLINE_SALES',
  'compra direta online': 'DIRECT_ONLINE_SALES',
  'venda direta': 'DIRECT_ONLINE_SALES',
  'venda online': 'ONLINE_SALES',
};

export interface AuctionQueryParams {
  state?: string;
  city?: string;
  neighborhood?: string;
  modality?: string;
  /** Price bounds in reais (AR-17), as GET /api/auctions takes them. */
  minPrice?: Decimal;
  maxPrice?: Decimal;
  /** AR-35 paging, as GET /api/auctions takes it: page ≥ 1, pageSize 1..100. */
  page?: number;
  pageSize?: number;
}

const SYSTEM_PROMPT = `Você é um assistente especializado em extrair informações de buscas de leilões de imóveis.

Sua tarefa é analisar a mensagem do usuário e extrair os seguintes parâmetros de busca:
- state: Sigla do estado brasileiro (ex: RN, SP, RJ, MG)
- city: Nome da cidade
- neighborhood: Nome do bairro
- modality: Modalidade do leilão (SFI_AUCTION, OPEN_BIDDING, DIRECT_ONLINE_SALES, ONLINE_SALES)
- minPrice: Valor mínimo em reais (número inteiro, sem formatação)
- maxPrice: Valor máximo em reais (número inteiro, sem formatação)
- pageSize: Quantidade de resultados por página (número inteiro de 1 a 100)
- page: Número da página (número inteiro, a partir de 1)

Regras de conversão:
1. Estados: Converta nomes completos para siglas (Rio Grande do Norte → RN, São Paulo → SP)
2. Valores monetários: Converta para números inteiros (R$ 300.000,00 → 300000, 300 mil → 300000, 1 milhão → 1000000)
3. Modalidades:
   - "leilão" ou "leilão sfi" ou "edital único" → SFI_AUCTION
   - "licitação aberta" → OPEN_BIDDING
   - "venda direta" ou "venda direta online" → DIRECT_ONLINE_SALES
   - "venda online" → ONLINE_SALES
4. Quantidade e página: "mostre 50 imóveis" → pageSize 50; "página 2" → page 2

Responda APENAS com um objeto JSON válido contendo os parâmetros encontrados. Se um parâmetro não for mencionado, não o inclua no JSON.

Exemplos:
- "Leilões em Natal/RN até 300 mil" → {"state": "RN", "city": "Natal", "maxPrice": 300000}
- "Apartamentos em São Paulo acima de 500 mil" → {"state": "SP", "city": "São Paulo", "minPrice": 500000}
- "Imóveis em leilão em Belo Horizonte" → {"state": "MG", "city": "Belo Horizonte", "modality": "SFI_AUCTION"}
- "Casas no bairro Boa Viagem em Recife entre 200 e 400 mil" → {"state": "PE", "city": "Recife", "neighborhood": "Boa Viagem", "minPrice": 200000, "maxPrice": 400000}
- "Mostre 50 imóveis em Natal/RN, página 2" → {"state": "RN", "city": "Natal", "pageSize": 50, "page": 2}`;

@Injectable()
export class NlpService {
  private readonly logger = new Logger(NlpService.name);

  constructor(private readonly llmAdapter: LlmAdapter) {}

  async extractQueryParams(userMessage: string): Promise<AuctionQueryParams> {
    try {
      const responseText = await this.llmAdapter.chat(SYSTEM_PROMPT, userMessage);

      if (!responseText) {
        this.logger.error('Empty response from LLM');
        return {};
      }

      // SC-15 / SC-22: the model's answer echoes the user's query text; log sizes and key counts only.
      this.logger.debug(`LLM response received (${responseText.length} chars)`);

      const params = this.parseJsonResponse(responseText);
      this.logger.debug('LLM response parsed');

      const normalizedParams = this.normalizeParams(params);
      this.logger.debug(`Normalized query params: ${Object.keys(normalizedParams).join(',')}`);

      return normalizedParams;
    } catch (error) {
      // A JSON parse error quotes the model's text, so only the error class is logged.
      this.logger.error(
        `Error extracting query params: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return {};
    }
  }

  private parseJsonResponse(jsonText: string): unknown {
    // Handle potential markdown code blocks
    const cleanJson = jsonText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    return JSON.parse(cleanJson);
  }

  /**
   * The model's JSON is untrusted: only the known parameters, with the right types, come out.
   * Anything else (an unknown key, a retired `limit`/`offset`, a string where a number belongs)
   * is dropped rather than handed to the search, which would refuse it (AR-34).
   */
  private normalizeParams(raw: unknown): AuctionQueryParams {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
    const values = raw as Record<string, unknown>;
    const params: AuctionQueryParams = {};

    const state = nonEmptyString(values.state);
    if (state) params.state = STATE_ABBREVIATIONS[state.toLowerCase()] ?? state.toUpperCase();

    const city = nonEmptyString(values.city);
    if (city) params.city = city;

    const neighborhood = nonEmptyString(values.neighborhood);
    if (neighborhood) params.neighborhood = neighborhood;

    const modality = nonEmptyString(values.modality);
    if (modality) params.modality = MODALITY_MAPPINGS[modality.toLowerCase()] ?? modality;

    const minPrice = moneyFromModel(values.minPrice);
    if (minPrice !== undefined) params.minPrice = minPrice;

    const maxPrice = moneyFromModel(values.maxPrice);
    if (maxPrice !== undefined) params.maxPrice = maxPrice;

    const page = positiveInteger(values.page);
    if (page !== undefined) params.page = page;

    // "mostre 200 imóveis" asks for more than a page holds: the most a page can (AR-35).
    const pageSize = positiveInteger(values.pageSize);
    if (pageSize !== undefined) params.pageSize = Math.min(pageSize, MAX_PAGE_SIZE);

    return params;
  }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * AR-17: an amount of reais from the model's JSON, where the prompt asks for a plain number
 * (300000). It becomes a Decimal through its text at once, and only when that text is an amount
 * GET /api/auctions accepts (MONEY_PATTERN): a negative, an exponent (1e21) or a third decimal is
 * dropped like any other mistyped value.
 */
function moneyFromModel(value: unknown): Decimal | undefined {
  const text = typeof value === 'number' && Number.isFinite(value) ? String(value) : value;
  return isMoneyString(text) ? new Decimal(text) : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : undefined;
}
