// #63: the default import. papaparse is a UMD bundle whose exports Node's CommonJS interop cannot
// see, so under native ESM its namespace holds only `default` and `Papa.parse` would be undefined.
import Papa from 'papaparse';
import { Decimal } from '../../common/money/money.js';
import {
  type ListColumn,
  findColumnLabel,
  missingColumns,
  normalizeColumnKey,
} from '../domain/list-columns.js';
import { parseGenerationDate } from '../domain/generation-date.js';
import { propertyTypeFromDescription } from '../domain/property-type.js';
import type { ListFacts } from '../domain/list-validator.js';

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
  /**
   * BR-004-11 fallback: the type the description begins with ("Casa"); null when it does not
   * (unknown, BR-004-15). The detail page's own value replaces it once collected.
   */
  propertyType: string | null;
  /** Reais (AR-17); null when the cell is empty or not a pt-BR amount. */
  appraisalPrice?: Decimal | null;
  minimumPrice?: Decimal | null;
  detailsUrl?: string;
}

/** A parsed list: the rows, and what BR-004-02 / BR-004-04 need to judge it (no row content). */
export interface ParsedList {
  rows: ParsedAuctionRow[];
  /** The header row's labels, null when no header row was found. */
  header: string[] | null;
  /** The list's "Data de geração" as a Brasília calendar day `YYYY-MM-DD`; null when absent. */
  generatedOn: string | null;
}

export function parseCsv(csv: string): ParsedAuctionRow[] {
  return parseCaixaList(csv).rows;
}

/** What the validator (domain/list-validator.ts) is told about a parsed list. */
export function listFacts(list: ParsedList): ListFacts {
  return {
    headerFound: list.header !== null,
    missingColumns: list.header === null ? [] : missingColumns(list.header),
    generatedOn: list.generatedOn,
    rowCount: list.rows.length,
  };
}

/**
 * The generation date line of the preamble, `Data de geração:;10/11/2025`: the first filled cell
 * after the label. It sits above the header, but is looked for in every row until the header.
 */
function findGenerationDate(preamble: string[][]): string | null {
  for (const row of preamble) {
    const at = row.findIndex(
      (cell) => normalizeColumnKey(cell).replace(/:$/, '') === 'data de geracao',
    );
    if (at === -1) continue;
    const value = row.slice(at + 1).find((cell) => cell.trim() !== '');
    return value === undefined ? null : parseGenerationDate(value);
  }
  return null;
}

export function parseCaixaList(csv: string): ParsedList {
  // Strip BOM if present
  csv = stripBom(csv);

  // Parse CSV with papaparse using semicolon delimiter
  const parseResult = Papa.parse<string[]>(csv, {
    delimiter: ';',
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim(),
  });

  const allRows = parseResult.data ?? [];

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

  const generatedOn = findGenerationDate(
    headerIndex === -1 ? allRows : allRows.slice(0, headerIndex),
  );
  if (!header || headerIndex === -1) return { rows: [], header: null, generatedOn };

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

  return { rows, header, generatedOn };
}

export function normalizeRows(rows: ParsedAuctionRow[]): NormalizedAuctionRow[] {
  return rows.map((r) => {
    const city = pick(r, 'city');
    const state = (pick(r, 'state') || '').toUpperCase();
    const title = pick(r, 'title');
    const street = pick(r, 'street');
    const neighborhood = pick(r, 'neighborhood');
    const modality = pick(r, 'modality');
    const appraisalPrice = parseCaixaMoney(pick(r, 'appraisalPrice'));
    const minimumPrice = parseCaixaMoney(pick(r, 'minimumPrice'));
    const detailsUrl = pick(r, 'detailsUrl');
    let code = pick(r, 'code');

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
      propertyType: propertyTypeFromDescription(title),
      appraisalPrice,
      minimumPrice,
      detailsUrl: detailsUrl || undefined,
    };
  });
}

function pick(row: Record<string, string>, column: ListColumn): string {
  const label = findColumnLabel(Object.keys(row), column);
  return label ? (row[label] ?? '') : '';
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

const normalizeKey = normalizeColumnKey;

function stripBom(s: string): string {
  if (s.charCodeAt(0) === 0xfeff) return s.slice(1);
  return s;
}
