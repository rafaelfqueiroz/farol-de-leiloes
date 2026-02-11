import { Injectable, Logger } from '@nestjs/common';
import { LlmAdapter } from '../adapters/llm.adapter';

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
  minMargin?: number;
  maxMargin?: number;
  limit?: number;
  offset?: number;
}

const SYSTEM_PROMPT = `Você é um assistente especializado em extrair informações de buscas de leilões de imóveis.

Sua tarefa é analisar a mensagem do usuário e extrair os seguintes parâmetros de busca:
- state: Sigla do estado brasileiro (ex: RN, SP, RJ, MG)
- city: Nome da cidade
- neighborhood: Nome do bairro
- modality: Modalidade do leilão (SFI_AUCTION, OPEN_BIDDING, DIRECT_ONLINE_SALES, ONLINE_SALES)
- minMargin: Valor mínimo em reais (número inteiro, sem formatação)
- maxMargin: Valor máximo em reais (número inteiro, sem formatação)
- limit: Número máximo de resultados

Regras de conversão:
1. Estados: Converta nomes completos para siglas (Rio Grande do Norte → RN, São Paulo → SP)
2. Valores monetários: Converta para números inteiros (R$ 300.000,00 → 300000, 300 mil → 300000, 1 milhão → 1000000)
3. Modalidades:
   - "leilão" ou "leilão sfi" ou "edital único" → SFI_AUCTION
   - "licitação aberta" → OPEN_BIDDING
   - "venda direta" ou "venda direta online" → DIRECT_ONLINE_SALES
   - "venda online" → ONLINE_SALES

Responda APENAS com um objeto JSON válido contendo os parâmetros encontrados. Se um parâmetro não for mencionado, não o inclua no JSON.

Exemplos:
- "Leilões em Natal/RN até 300 mil" → {"state": "RN", "city": "Natal", "maxMargin": 300000}
- "Apartamentos em São Paulo acima de 500 mil" → {"state": "SP", "city": "São Paulo", "minMargin": 500000}
- "Imóveis em leilão em Belo Horizonte" → {"state": "MG", "city": "Belo Horizonte", "modality": "SFI_AUCTION"}
- "Casas no bairro Boa Viagem em Recife entre 200 e 400 mil" → {"state": "PE", "city": "Recife", "neighborhood": "Boa Viagem", "minMargin": 200000, "maxMargin": 400000}`;

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

      this.logger.debug(`LLM raw response: ${responseText}`);

      const params = this.parseJsonResponse(responseText);
      this.logger.debug(`Parsed query params: ${JSON.stringify(params)}`);

      const normalizedParams = this.normalizeParams(params);
      this.logger.debug(`Normalized query params: ${JSON.stringify(normalizedParams)}`);

      return normalizedParams;
    } catch (error) {
      this.logger.error(`Error extracting query params: ${error}`);
      return {};
    }
  }

  private parseJsonResponse(jsonText: string): AuctionQueryParams {
    // Handle potential markdown code blocks
    const cleanJson = jsonText
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();

    return JSON.parse(cleanJson);
  }

  private normalizeParams(params: AuctionQueryParams): AuctionQueryParams {
    // Validate and normalize state abbreviation
    if (params.state) {
      const normalizedState = params.state.toLowerCase();
      params.state = STATE_ABBREVIATIONS[normalizedState] || params.state.toUpperCase();
    }

    // Validate modality
    if (params.modality) {
      const normalizedModality = params.modality.toLowerCase();
      params.modality = MODALITY_MAPPINGS[normalizedModality] || params.modality;
    }

    return params;
  }
}
