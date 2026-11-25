// SPEC-004 BR-004-04: the columns the daily Caixa list must have, and the names Caixa has used for
// each. Pure (AR-05): the importer's parser and the list validator read the same table, so what is
// "present" for validation is exactly what the parser can read.

export type ListColumn =
  | 'code'
  | 'state'
  | 'city'
  | 'neighborhood'
  | 'street'
  | 'minimumPrice'
  | 'appraisalPrice'
  | 'title'
  | 'modality'
  | 'detailsUrl';

/** Header labels per column, as written (matched without case, accents or spacing). */
export const COLUMN_ALIASES: Readonly<Record<ListColumn, readonly string[]>> = {
  code: [
    'N° do imóvel',
    'Nº do imóvel',
    'No do imovel',
    'Numero do imovel',
    'Código',
    'Codigo',
    'Identificador',
    'Matricula',
  ],
  state: ['UF', 'Estado'],
  city: ['Cidade', 'Municipio', 'Município'],
  neighborhood: ['Bairro'],
  street: ['Endereço', 'Endereco', 'Logradouro'],
  minimumPrice: ['Preço', 'Preco', 'ValorMinimo', 'Valor Minimo', 'Valor de Venda', 'Valor Venda'],
  appraisalPrice: ['Valor de avaliação', 'ValorAvaliacao', 'Valor Avaliacao', 'Valor de avaliacao'],
  title: ['Descrição', 'Descricao', 'Imóvel', 'Imovel', 'Bem'],
  modality: ['Modalidade de venda', 'Modalidade', 'TipoVenda'],
  detailsUrl: ['Link de acesso', 'Link', 'URL', 'Url'],
};

/**
 * Columns a list must carry. `code` is not among them: the property number is also read from the
 * link (`hdnimovel=`), so a list with the link column has it.
 */
export const REQUIRED_COLUMNS: readonly ListColumn[] = [
  'state',
  'city',
  'neighborhood',
  'street',
  'minimumPrice',
  'appraisalPrice',
  'title',
  'modality',
  'detailsUrl',
];

/** A label compared without accents, case, or runs of spaces: "Preço " and "PRECO" are one. */
export function normalizeColumnKey(label: string): string {
  return label
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** The header label that holds `column`, or undefined. The first alias present wins. */
export function findColumnLabel(header: readonly string[], column: ListColumn): string | undefined {
  const byKey = new Map(header.map((label) => [normalizeColumnKey(label), label]));
  for (const alias of COLUMN_ALIASES[column]) {
    const label = byKey.get(normalizeColumnKey(alias));
    if (label !== undefined) return label;
  }
  return undefined;
}

/** The required columns the header lacks, in the order of REQUIRED_COLUMNS. */
export function missingColumns(header: readonly string[]): ListColumn[] {
  return REQUIRED_COLUMNS.filter((column) => findColumnLabel(header, column) === undefined);
}
