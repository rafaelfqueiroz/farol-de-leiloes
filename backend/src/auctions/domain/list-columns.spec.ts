import { describe, expect, it } from 'vitest';
import {
  COLUMN_ALIASES,
  REQUIRED_COLUMNS,
  findColumnLabel,
  missingColumns,
  normalizeColumnKey,
} from './list-columns.js';

const HEADER = [
  'N° do imóvel',
  'UF',
  'Cidade',
  'Bairro',
  'Endereço',
  'Preço',
  'Valor de avaliação',
  'Desconto',
  'Descrição',
  'Modalidade de venda',
  'Link de acesso',
];

describe('normalizeColumnKey', () => {
  it('drops accents, case and extra spaces', () => {
    expect(normalizeColumnKey('  Valor  de AVALIAÇÃO ')).toBe('valor de avaliacao');
  });
});

describe('findColumnLabel', () => {
  it('finds a column under its label as written', () => {
    expect(findColumnLabel(HEADER, 'state')).toBe('UF');
    expect(findColumnLabel(HEADER, 'appraisalPrice')).toBe('Valor de avaliação');
  });

  it('finds it under another accepted spelling, whatever the case and accents', () => {
    expect(findColumnLabel(['MUNICIPIO'], 'city')).toBe('MUNICIPIO');
    expect(findColumnLabel(['preco'], 'minimumPrice')).toBe('preco');
  });

  it('is undefined when no alias is present', () => {
    expect(findColumnLabel(['Outra coisa'], 'city')).toBeUndefined();
  });

  it('prefers the earlier alias when two are present', () => {
    expect(findColumnLabel(['Município', 'Cidade'], 'city')).toBe('Cidade');
  });
});

describe('missingColumns (BR-004-04)', () => {
  it('is empty for the layout Caixa publishes', () => {
    expect(missingColumns(HEADER)).toEqual([]);
  });

  it('is empty when the columns come in another order', () => {
    expect(missingColumns([...HEADER].reverse())).toEqual([]);
  });

  it('names each required column the header lacks, in a fixed order', () => {
    expect(
      missingColumns(HEADER.filter((l) => l !== 'Valor de avaliação' && l !== 'Bairro')),
    ).toEqual(['neighborhood', 'appraisalPrice']);
  });

  it('does not require the code column: the link carries the number', () => {
    expect(missingColumns(HEADER.filter((l) => l !== 'N° do imóvel'))).toEqual([]);
  });

  it('names everything for a header of another layout', () => {
    expect(missingColumns(['Código', 'Valor'])).toEqual([...REQUIRED_COLUMNS]);
  });

  it('keeps an alias table entry for every required column', () => {
    for (const column of REQUIRED_COLUMNS) expect(COLUMN_ALIASES[column].length).toBeGreaterThan(0);
  });
});
