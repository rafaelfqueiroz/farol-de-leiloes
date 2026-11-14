// #63: the default import. papaparse is a UMD bundle whose exports Node's CommonJS interop cannot
// see, so under native ESM its namespace holds only `default` and `Papa.parse` would be undefined.
import Papa from 'papaparse';
import { Decimal } from '../../common/money/money.js';

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
  /** Reais (AR-17); null when the cell is empty or not a pt-BR amount. */
  appraisalPrice?: Decimal | null;
  minimumPrice?: Decimal | null;
  detailsUrl?: string;
}

export function parseCsv(csv: string): ParsedAuctionRow[] {
  // Strip BOM if present
  csv = stripBom(csv);

  // Parse CSV with papaparse using semicolon delimiter
  const parseResult = Papa.parse<string[]>(csv, {
    delimiter: ';',
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  });

  if (!parseResult.data || parseResult.data.length === 0) return [];

  const allRows = parseResult.data;

  // Find the true header row; skip title lines like "Lista de Imóveis..."
  let headerIndex = -1;
  let header: string[] | null = null;

  for (const [i, row] of allRows.entries()) {
    const labels = row.map((col) => normalizeKey(col));
    const hasUF = labels.includes('uf');
    const hasCidade = labels.includes('cidade');
    const hasModalidade =
      labels.includes('modalidade de venda') || labels.includes('modalidadedevenda');

    if (hasUF && hasCidade && hasModalidade) {
      header = row.map((col) => col.trim());
      headerIndex = i;
      break;
    }
  }

  if (!header || headerIndex === -1) return [];

  // Convert rows to objects using the found header
  const rows: ParsedAuctionRow[] = [];
  for (const rowData of allRows.slice(headerIndex + 1)) {
    // Skip empty rows
    if (rowData.every((cell) => !cell || cell.trim() === '')) continue;

    const row: ParsedAuctionRow = {};
    for (const [j, column] of header.entries()) {
      row[column] = (rowData[j] ?? '').trim();
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
    const appraisalPrice = parseCaixaMoney(
      pick(r, ['Valor de avaliação', 'ValorAvaliacao', 'Valor Avaliacao', 'Valor de avaliacao']),
    );
    const minimumPrice = parseCaixaMoney(
      pick(r, ['Preço', 'Preco', 'ValorMinimo', 'Valor Minimo', 'Valor de Venda', 'Valor Venda']),
    );
    const detailsUrl = pick(r, ['Link de acesso', 'Link', 'URL', 'Url']);
    let code = pick(r, [
      'N° do imóvel',
      'Nº do imóvel',
      'No do imovel',
      'Numero do imovel',
      'Código',
      'Codigo',
      'Identificador',
      'Matricula',
    ]);

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
  return k ? (row[k] ?? '') : '';
}

function findKey(row: Record<string, string>, keys: string[]): string | undefined {
  const lower = Object.fromEntries(Object.entries(row).map(([k]) => [normalizeKey(k), k]));
  for (const k of keys) {
    const norm = normalizeKey(k);
    if (lower[norm]) return lower[norm];
  }
  return undefined;
}

// A pt-BR amount as Caixa writes it: an optional `R$`, digits grouped in threes by dots or not
// grouped at all, and up to two decimals after a comma — "91.589,89", "250000,00", "R$ 1.234".
const CAIXA_MONEY = /^(?:\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?$/;

/**
 * SPEC-004 / AR-17: a Caixa price cell in reais, as a Decimal — the text is parsed digit for digit
 * and never passes through a float. A cell that is not a pt-BR amount is null, not a guess: the
 * previous parser dropped every dot, so "91589.89" (a dot-decimal amount) silently became
 * 9158989; now it is refused, as are a sign, a third decimal and misplaced group separators.
 *
 *   parseCaixaMoney('91.589,89')    → 91589.89
 *   parseCaixaMoney('R$ 1.234,5')   → 1234.5
 *   parseCaixaMoney('91589.89')     → null (ambiguous: dot as decimal)
 */
export function parseCaixaMoney(cell: string): Decimal | null {
  // NBSP and other whitespace appear between "R$" and the digits in Caixa's exports.
  const text = cell.replace(/^\s*R\$/i, '').replace(/\s/g, '');
  if (!CAIXA_MONEY.test(text)) return null;
  return new Decimal(text.replace(/\./g, '').replace(',', '.'));
}

function removeDiacritics(s: string) {
  return s.normalize('NFD').replace(/\p{Diacritic}+/gu, '');
}

function normalizeKey(s: string): string {
  return removeDiacritics(String(s || ''))
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function stripBom(s: string): string {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}
