import { AuctionQueryParams, STATE_ABBREVIATIONS, MODALITY_MAPPINGS } from './constants';
import { getLLMConfig, validateLLMConfig, LLMConfig } from './llm-providers';

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

interface OpenAICompatibleResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

interface AnthropicResponse {
  content: Array<{
    type: string;
    text?: string;
  }>;
}

async function callOpenAICompatibleAPI(
  config: LLMConfig,
  userMessage: string
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      max_tokens: 256,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`LLM API error (${response.status}): ${errorText}`);
  }

  const data: OpenAICompatibleResponse = await response.json();
  return data.choices[0]?.message?.content || '';
}

async function callAnthropicAPI(
  config: LLMConfig,
  userMessage: string
): Promise<string> {
  const response = await fetch(`${config.baseUrl}/messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey || '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 256,
      system: SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userMessage },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  const data: AnthropicResponse = await response.json();
  const textContent = data.content.find((block) => block.type === 'text');
  return textContent?.text || '';
}

async function callLLM(userMessage: string): Promise<string> {
  const config = getLLMConfig();

  // Validate configuration
  const validation = validateLLMConfig(config);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  console.log(`Using LLM provider: ${config.provider} (model: ${config.model})`);

  // Anthropic has a different API format
  if (config.provider === 'anthropic') {
    return callAnthropicAPI(config, userMessage);
  }

  // All other providers use OpenAI-compatible API
  return callOpenAICompatibleAPI(config, userMessage);
}

function parseJSONResponse(jsonText: string): AuctionQueryParams {
  // Handle potential markdown code blocks
  const cleanJson = jsonText
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  return JSON.parse(cleanJson);
}

function normalizeParams(params: AuctionQueryParams): AuctionQueryParams {
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

export async function extractQueryParams(userMessage: string): Promise<AuctionQueryParams> {
  try {
    const responseText = await callLLM(userMessage);

    if (!responseText) {
      console.error('Empty response from LLM');
      return {};
    }

    console.log('[NLP] LLM raw response:', responseText);

    const params = parseJSONResponse(responseText);
    console.log('[NLP] Parsed query params:', JSON.stringify(params, null, 2));

    const normalizedParams = normalizeParams(params);
    console.log('[NLP] Normalized query params:', JSON.stringify(normalizedParams, null, 2));

    return normalizedParams;
  } catch (error) {
    console.error('Error extracting query params:', error);
    return {};
  }
}

// Format auction results into a user-friendly message
export async function formatAuctionResults(
  params: AuctionQueryParams,
  results: { total: number; items: any[] }
): Promise<string> {
  if (results.total === 0) {
    return 'Não encontrei leilões com os critérios especificados. Tente ajustar os filtros de busca.';
  }

  const locationParts: string[] = [];
  if (params.city) locationParts.push(params.city);
  if (params.state) locationParts.push(params.state);
  const location = locationParts.length > 0 ? locationParts.join('/') : 'Brasil';

  let response = `Encontrei ${results.total} leilão(ões) em ${location}.\n\n`;

  results.items.forEach((auction, index) => {
    response += `**${index + 1}. ${auction.title || 'Imóvel'}**\n`;
    response += `- Código: ${auction.code}\n`;
    if (auction.address) response += `- Endereço: ${auction.address}\n`;
    if (auction.city && auction.state) response += `- Localização: ${auction.city}/${auction.state}\n`;
    if (auction.appraisalValue) {
      response += `- Valor de avaliação: R$ ${auction.appraisalValue.toLocaleString('pt-BR')}\n`;
    }
    if (auction.minimumBid) {
      response += `- Lance mínimo: R$ ${auction.minimumBid.toLocaleString('pt-BR')}\n`;
    }
    if (auction.discount) {
      response += `- Desconto: ${auction.discount}%\n`;
    }
    if (auction.modality) response += `- Modalidade: ${auction.modality}\n`;
    response += '\n';
  });

  if (results.total > results.items.length) {
    response += `\n_Mostrando ${results.items.length} de ${results.total} resultados._`;
  }

  return response;
}
