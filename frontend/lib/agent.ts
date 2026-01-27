import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';

const AUCTIONS_API_URL = process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';

// State abbreviations mapping
const STATE_ABBREVIATIONS: Record<string, string> = {
  'acre': 'AC', 'alagoas': 'AL', 'amapá': 'AP', 'amapa': 'AP',
  'amazonas': 'AM', 'bahia': 'BA', 'ceará': 'CE', 'ceara': 'CE',
  'distrito federal': 'DF', 'espírito santo': 'ES', 'espirito santo': 'ES',
  'goiás': 'GO', 'goias': 'GO', 'maranhão': 'MA', 'maranhao': 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG',
  'pará': 'PA', 'para': 'PA', 'paraíba': 'PB', 'paraiba': 'PB',
  'paraná': 'PR', 'parana': 'PR', 'pernambuco': 'PE', 'piauí': 'PI',
  'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
  'rio grande do sul': 'RS', 'rondônia': 'RO', 'rondonia': 'RO',
  'roraima': 'RR', 'santa catarina': 'SC', 'são paulo': 'SP',
  'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO',
  'rn': 'RN', 'sp': 'SP', 'rj': 'RJ', 'mg': 'MG', 'ba': 'BA',
};

// Query auctions function
async function queryAuctionsAPI(params: {
  state?: string;
  city?: string;
  neighborhood?: string;
  modality?: string;
  minMargin?: number;
  maxMargin?: number;
  limit?: number;
  offset?: number;
}): Promise<string> {
  try {
    const queryParams = new URLSearchParams();
    if (params.state) queryParams.set('state', params.state);
    if (params.city) queryParams.set('city', params.city);
    if (params.neighborhood) queryParams.set('neighborhood', params.neighborhood);
    if (params.modality) queryParams.set('modality', params.modality);
    if (params.minMargin) queryParams.set('minMargin', params.minMargin.toString());
    if (params.maxMargin) queryParams.set('maxMargin', params.maxMargin.toString());
    if (params.limit) queryParams.set('limit', params.limit.toString());
    if (params.offset) queryParams.set('offset', params.offset.toString());

    const response = await fetch(`${AUCTIONS_API_URL}/auctions?${queryParams}`);

    if (!response.ok) {
      throw new Error(`API request failed: ${response.statusText}`);
    }

    const data = await response.json();
    return JSON.stringify(data, null, 2);
  } catch (error: any) {
    return `Error querying auctions: ${error.message}`;
  }
}

// Define the tool schema
const queryAuctionsSchema = z.object({
  state: z.string().optional().describe('State abbreviation (e.g., RN, SP, RJ)'),
  city: z.string().optional().describe('City name (e.g., Natal, São Paulo)'),
  neighborhood: z.string().optional().describe('Neighborhood name'),
  modality: z.string().optional().describe('Auction modality: SFI_AUCTION, OPEN_BIDDING, DIRECT_ONLINE_SALES, or ONLINE_SALES'),
  minMargin: z.number().optional().describe('Minimum price filter (in BRL)'),
  maxMargin: z.number().optional().describe('Maximum price filter (in BRL)'),
  limit: z.number().optional().describe('Maximum number of results to return (default: 10)'),
  offset: z.number().optional().describe('Number of results to skip for pagination'),
});

export async function queryAuctions(userMessage: string): Promise<string> {
  const model = new ChatOpenAI({
    modelName: 'gpt-4o-mini',
    temperature: 0,
    openAIApiKey: process.env.OPENAI_API_KEY,
  }).bindTools([
    {
      type: 'function' as const,
      function: {
        name: 'query_auctions',
        description: 'Query auctions from the Caixa Economica Federal database. Supports filtering by state, city, neighborhood, modality, and price range.',
        parameters: {
          type: 'object',
          properties: {
            state: {
              type: 'string',
              description: 'State abbreviation (e.g., RN, SP, RJ)',
            },
            city: {
              type: 'string',
              description: 'City name (e.g., Natal, São Paulo)',
            },
            neighborhood: {
              type: 'string',
              description: 'Neighborhood name',
            },
            modality: {
              type: 'string',
              description: 'Auction modality: SFI_AUCTION, OPEN_BIDDING, DIRECT_ONLINE_SALES, or ONLINE_SALES',
            },
            minMargin: {
              type: 'number',
              description: 'Minimum price filter (in BRL)',
            },
            maxMargin: {
              type: 'number',
              description: 'Maximum price filter (in BRL)',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of results to return (default: 10)',
            },
            offset: {
              type: 'number',
              description: 'Number of results to skip for pagination',
            },
          },
        },
      },
    },
  ]);

  const systemPrompt = `Você é um assistente especializado em ajudar usuários a encontrar leilões de imóveis da Caixa Econômica Federal.

Seu trabalho é:
1. Extrair informações relevantes da mensagem do usuário (estado, cidade, bairro, modalidade de leilão, faixa de preço)
2. Mapear estados para suas abreviações (ex: Rio Grande do Norte -> RN, São Paulo -> SP)
3. Mapear modalidades para os valores corretos:
   - "Leilão" ou "Leilão SFI" ou "Edital Único" -> SFI_AUCTION
   - "Licitação Aberta" -> OPEN_BIDDING
   - "Venda Direta" ou "Venda Direta Online" -> DIRECT_ONLINE_SALES
   - "Venda Online" -> ONLINE_SALES
4. Converter valores em reais (R$) para números (ex: R$ 200.000,00 -> 200000)
5. Usar a ferramenta query_auctions com os filtros corretos
6. Apresentar os resultados de forma clara e organizada em português

Quando apresentar os resultados:
- Mostre o número total de leilões encontrados
- Liste os detalhes de cada leilão de forma clara
- Inclua: código, título, endereço, cidade, estado, preço de avaliação, fases do leilão
- Se não houver resultados, explique de forma educada

Abreviações de estados brasileiros:
${Object.entries(STATE_ABBREVIATIONS).map(([name, abbr]) => `${name}: ${abbr}`).join(', ')}`;

  // First call: Get the function call
  const firstResponse = await model.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]);

  // Check if there's a tool call
  const toolCalls = firstResponse.additional_kwargs?.tool_calls;

  if (!toolCalls || toolCalls.length === 0) {
    return firstResponse.content as string;
  }

  // Execute the tool call
  const toolCall = toolCalls[0];
  const functionArgs = JSON.parse(toolCall.function.arguments);
  const toolResult = await queryAuctionsAPI(functionArgs);

  // Second call: Get the final response with the tool result
  const finalResponse = await model.invoke([
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
    { role: 'assistant', content: '', additional_kwargs: { tool_calls: toolCalls } },
    { role: 'tool', content: toolResult, tool_call_id: toolCall.id },
  ]);

  return finalResponse.content as string;
}
