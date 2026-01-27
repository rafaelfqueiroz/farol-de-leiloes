// State abbreviations mapping (full names → 2-letter codes)
export const STATE_ABBREVIATIONS: Record<string, string> = {
  'acre': 'AC',
  'alagoas': 'AL',
  'amapá': 'AP',
  'amapa': 'AP',
  'amazonas': 'AM',
  'bahia': 'BA',
  'ceará': 'CE',
  'ceara': 'CE',
  'distrito federal': 'DF',
  'espírito santo': 'ES',
  'espirito santo': 'ES',
  'goiás': 'GO',
  'goias': 'GO',
  'maranhão': 'MA',
  'maranhao': 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  'pará': 'PA',
  'para': 'PA',
  'paraíba': 'PB',
  'paraiba': 'PB',
  'paraná': 'PR',
  'parana': 'PR',
  'pernambuco': 'PE',
  'piauí': 'PI',
  'piaui': 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  'rondônia': 'RO',
  'rondonia': 'RO',
  'roraima': 'RR',
  'santa catarina': 'SC',
  'são paulo': 'SP',
  'sao paulo': 'SP',
  'sergipe': 'SE',
  'tocantins': 'TO',
  // Also accept abbreviations directly
  'ac': 'AC',
  'al': 'AL',
  'ap': 'AP',
  'am': 'AM',
  'ba': 'BA',
  'ce': 'CE',
  'df': 'DF',
  'es': 'ES',
  'go': 'GO',
  'ma': 'MA',
  'mt': 'MT',
  'ms': 'MS',
  'mg': 'MG',
  'pa': 'PA',
  'pb': 'PB',
  'pr': 'PR',
  'pe': 'PE',
  'pi': 'PI',
  'rj': 'RJ',
  'rn': 'RN',
  'rs': 'RS',
  'ro': 'RO',
  'rr': 'RR',
  'sc': 'SC',
  'sp': 'SP',
  'se': 'SE',
  'to': 'TO',
};

// Modality mappings (Portuguese → API values)
export const MODALITY_MAPPINGS: Record<string, string> = {
  'leilão': 'SFI_AUCTION',
  'leilao': 'SFI_AUCTION',
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

// Auction query parameters interface
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

// Auction result interface
export interface Auction {
  code: string;
  title: string;
  address: string;
  city: string;
  state: string;
  neighborhood?: string;
  appraisalValue: number;
  minimumBid?: number;
  discount?: number;
  modality: string;
  auctionDate?: string;
  description?: string;
  imageUrl?: string;
}

export interface AuctionResult {
  total: number;
  items: Auction[];
}

// API URL
export const AUCTIONS_API_URL = process.env.AUCTIONS_API_URL || process.env.NEXT_PUBLIC_AUCTIONS_API_URL || 'http://localhost:3000';
