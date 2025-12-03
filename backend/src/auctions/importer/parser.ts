import * as Papa from 'papaparse';

export interface ParsedAuctionRow {
  [key: string]: string;
}

export interface NormalizedAuctionRow {
  code?: string;
  title?: string;
  state?: string;
  city?: string;
  street?: string;
  neighborhood?: string;
  modality?: string;
  appraisalPrice?: number | null;
  minimumPrice?: number | null;
  detailsUrl?: string;
}

export function parseCsv(csv: string): ParsedAuctionRow[] {
  // Strip BOM if present
  csv = stripBom(csv);

  // Parse CSV with papaparse using semicolon delimiter
  const parseResult = Papa.parse(csv, {
    delimiter: ';',
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  });

  if (!parseResult.data || parseResult.data.length === 0) return [];

  const allRows = parseResult.data as string[][];

  // Find the true header row; skip title lines like "Lista de Imóveis..."
  let headerIndex = -1;
  let header: string[] | null = null;

  for (let i = 0; i < allRows.length; i++) {
    const row = allRows[i];
    const labels = row.map((col) => normalizeKey(col));
    const hasUF = labels.includes('uf');
    const hasCidade = labels.includes('cidade');
    const hasModalidade = labels.includes('modalidade de venda') || labels.includes('modalidadedevenda');

    if (hasUF && hasCidade && hasModalidade) {
      header = row.map((col) => col.trim());
      headerIndex = i;
      break;
    }
  }

  if (!header || headerIndex === -1) return [];

  // Log headers for debugging
  console.log('CSV Headers found:', header);
  console.log('Header count:', header.length);

  // Convert rows to objects using the found header
  const rows: ParsedAuctionRow[] = [];
  for (let i = headerIndex + 1; i < allRows.length; i++) {
    const rowData = allRows[i];

    // Skip empty rows
    if (rowData.every((cell) => !cell || cell.trim() === '')) continue;

    const row: ParsedAuctionRow = {};
    for (let j = 0; j < header.length; j++) {
      row[header[j]] = (rowData[j] ?? '').trim();
    }
    rows.push(row);
  }

  return rows;
}

export function normalizeRows(rows: ParsedAuctionRow[]): NormalizedAuctionRow[] {
  return rows.map((r) => {
    const city = pick(r, ['Cidade', 'Municipio', 'Município']);
    const state = (pick(r, ['UF', 'Estado']) || '').toUpperCase();
    const title = pick(r, ['Descrição', 'Descricao', 'Imóvel', 'Imovel', 'Bem']);
    const street = pick(r, ['Endereço', 'Endereco', 'Logradouro']);
    const neighborhood = pick(r, ['Bairro']);
    const modality = pick(r, ['Modalidade de venda', 'Modalidade', 'TipoVenda']);
    const appraisalPrice = parseMoney(pick(r, ['Valor de avaliação', 'ValorAvaliacao', 'Valor Avaliacao', 'Valor de avaliacao']));
    const minimumPrice = parseMoney(pick(r, ['Preço', 'Preco', 'ValorMinimo', 'Valor Minimo', 'Valor de Venda', 'Valor Venda']));
    const detailsUrl = pick(r, ['Link de acesso', 'Link', 'URL', 'Url']);
    let code = pick(r, ['N° do imóvel', 'Nº do imóvel', 'No do imovel', 'Numero do imovel', 'Código', 'Codigo', 'Identificador', 'Matricula']);

    // If code is not available from the column, extract it from detailsUrl
    // Example: https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1444419970935
    if (!code && detailsUrl) {
      const match = detailsUrl.match(/hdnimovel=(\d+)/i);
      if (match && match[1]) {
        code = match[1];
      }
    }

    return {
      code: code || undefined,
      title: title || undefined,
      state: state || undefined,
      city: city || undefined,
      street: street || undefined,
      neighborhood: neighborhood || undefined,
      modality: modality || undefined,
      appraisalPrice,
      minimumPrice,
      detailsUrl: detailsUrl || undefined,
    };
  });
}

function pick(row: Record<string, string>, keys: string[]): string {
  const k = findKey(row, keys);
  return k ? row[k] : '';
}

function findKey(row: Record<string, string>, keys: string[]): string | undefined {
  const lower = Object.fromEntries(
    Object.entries(row).map(([k]) => [normalizeKey(k), k]),
  );
  for (const k of keys) {
    const norm = normalizeKey(k);
    if (lower[norm]) return lower[norm];
  }
  return undefined;
}

function parseMoney(s: string): number | null {
  if (!s) return null;
  const t = s.replace(/\./g, '').replace(/\s/g, '').replace(/R\$\s*/i, '').replace(/,/g, '.');
  const n = Number(t);
  return isFinite(n) && !isNaN(n) ? n : null;
}

function removeDiacritics(s: string) {
  return s.normalize('NFD').replace(/\p{Diacritic}+/gu, '');
}

function normalizeKey(s: string): string {
  return removeDiacritics(String(s || '')).replace(/\s+/g, ' ').trim().toLowerCase();
}

function stripBom(s: string): string {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}
