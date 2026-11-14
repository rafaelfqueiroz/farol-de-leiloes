import { describe, expect, it } from 'vitest';
import { parseCsv, normalizeRows, parseCaixaMoney } from './parser.js';
import { readCaixaFixture } from '../../../test/support/fixtures.js';

describe('CSV parser', () => {
  it('parses Lista_imoveis_geral.csv and returns 4 rows', () => {
    const csv = readCaixaFixture('Lista_imoveis_geral.csv');
    const rows = parseCsv(csv);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(4);
  });

  it('normalizes rows and extracts all required fields', () => {
    const csv = readCaixaFixture('Lista_imoveis_geral.csv');
    const parsed = parseCsv(csv);
    const normalized = normalizeRows(parsed);

    expect(normalized.length).toBe(4);

    // Test each row has the required fields (except phase minimumPrice/date and address zipcode)
    normalized.forEach((row) => {
      // Code should be present (either from column or extracted from URL)
      expect(row.code).toBeDefined();
      expect(row.code).not.toBe('');

      // State should be present
      expect(row.state).toBeDefined();
      expect(row.state).not.toBe('');

      // City should be present
      expect(row.city).toBeDefined();
      expect(row.city).not.toBe('');

      // Neighborhood should be present
      expect(row.neighborhood).toBeDefined();
      expect(row.neighborhood).not.toBe('');

      // Modality should be present
      expect(row.modality).toBeDefined();
      expect(row.modality).not.toBe('');

      // Details URL should be present
      expect(row.detailsUrl).toBeDefined();
      expect(row.detailsUrl).not.toBe('');
      expect(row.detailsUrl).toContain('venda-imoveis.caixa.gov.br');

      // Note: title, street, appraisalPrice, and minimumPrice may be null/undefined
      // Phase minimumPrice and date are allowed to be null
      // Address zipcode is allowed to be undefined
    });

    // Specific assertions for known data
    const [first, second] = normalized;

    // First row
    expect(first?.code).toBe('1444419970935');
    expect(first?.state).toBe('AC');
    expect(first?.city).toBe('CRUZEIRO DO SUL');
    expect(first?.neighborhood).toBe('ZONA RURAL');
    expect(first?.detailsUrl).toContain('hdnimovel=1444419970935');

    // Second row
    expect(second?.code).toBe('1444418010407');
    expect(second?.state).toBe('TO');
    expect(second?.city).toBe('PARAISO DO TOCANTINS');
  });

  it('AR-17: reads the fixture prices as exact Decimals of reais', () => {
    const normalized = normalizeRows(parseCsv(readCaixaFixture('Lista_imoveis_geral.csv')));

    // From the fixture: "Preço" and "Valor de avaliação" of each row, in pt-BR.
    expect(
      normalized.map((row) => [row.minimumPrice?.toFixed(), row.appraisalPrice?.toFixed()]),
    ).toEqual([
      ['91589.89', '250000'],
      ['235000', '235000'],
      ['222804.3', '222804.3'],
      ['74628.94', '130000'],
    ]);
  });
});

// TS-12: the price cells, adversarially. A cell that is not a pt-BR amount is refused (null), never
// guessed: the old parser dropped every dot, so a dot-decimal "91589.89" became 9158989.
describe('parseCaixaMoney', () => {
  it.each([
    ['91.589,89', '91589.89'],
    ['250.000,00', '250000'],
    ['1.234.567,8', '1234567.8'],
    ['0,00', '0'],
    ['0,5', '0.5'],
    ['999', '999'],
    ['1.234', '1234'], // a dot groups thousands in pt-BR
    ['250000,00', '250000'], // ungrouped digits are fine
    ['R$ 1.234,56', '1234.56'],
    ['R$\u00a01.234,56', '1234.56'], // NBSP after the currency sign
    [' 74.628,94 ', '74628.94'],
  ])('reads %j as %s reais', (cell, reais) => {
    expect(parseCaixaMoney(cell)?.toFixed()).toBe(reais);
  });

  it.each([
    '',
    '   ',
    '91589.89', // a dot as the decimal separator: ambiguous, refused
    '1,234', // three decimals
    '1,2,3',
    '12.34,56', // a misplaced group
    '1.2345,00',
    '-1.234,56', // prices are not negative
    '+10,00',
    'abc',
    '1e5',
    'R$',
    '63.37', // the "Desconto" column, a percentage
  ])('refuses %j', (cell) => {
    expect(parseCaixaMoney(cell)).toBeNull();
  });

  it('never passes through a float: 0,10 + 0,20 is exactly 0.3', () => {
    const sum = parseCaixaMoney('0,10')?.plus(parseCaixaMoney('0,20') ?? 0);

    expect(sum?.toFixed()).toBe('0.3');
  });
});
