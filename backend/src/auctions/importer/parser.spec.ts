import { describe, expect, it } from 'vitest';
import { listFacts, normalizeRows, parseCaixaList, parseCaixaMoney, parseCsv } from './parser.js';
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

// SPEC-004 BR-004-02, BR-004-04, TS-12: the awkward lists Caixa has sent or could send. The
// fixtures are derived from the captured list, trimmed (TS-28); none holds personal data.
describe('parseCaixaList', () => {
  it('reads the generation date of the captured list as a Brasília calendar day', () => {
    const list = parseCaixaList(readCaixaFixture('Lista_imoveis_geral.csv'));

    expect(list.generatedOn).toBe('2025-11-10');
    expect(list.rows).toHaveLength(4);
    expect(listFacts(list)).toEqual({
      headerFound: true,
      missingColumns: [],
      generatedOn: '2025-11-10',
      rowCount: 4,
    });
  });

  it('reads a list that starts with a BOM, has extra metadata rows and reordered columns', () => {
    const csv = readCaixaFixture('lista-bom-reordered.csv');
    expect(csv.charCodeAt(0)).toBe(0xfeff);

    const list = parseCaixaList(csv);
    const normalized = normalizeRows(list.rows);

    expect(list.generatedOn).toBe('2025-11-10');
    expect(listFacts(list).missingColumns).toEqual([]);
    expect(normalized.map((row) => [row.code, row.state, row.city])).toEqual([
      ['1444419970935', 'AC', 'CRUZEIRO DO SUL'],
      ['1444418010407', 'TO', 'PARAISO DO TOCANTINS'],
      ['1444416160541', 'TO', 'PARAISO DO TOCANTINS'],
    ]);
    expect(normalized[1]?.minimumPrice?.toFixed()).toBe('235000');
    expect(normalized[1]?.detailsUrl).toContain('hdnimovel=1444418010407');
  });

  it('names the required column a list lacks', () => {
    const list = parseCaixaList(readCaixaFixture('lista-missing-column.csv'));

    expect(list.rows).toHaveLength(3);
    expect(listFacts(list).missingColumns).toEqual(['appraisalPrice']);
    // The rows are still read: the validator, not the parser, rejects the list.
    expect(normalizeRows(list.rows)[0]?.appraisalPrice).toBeNull();
  });

  it('reads a malformed price as unknown (null), never as a wrong amount (AR-17)', () => {
    const rows = normalizeRows(parseCaixaList(readCaixaFixture('lista-malformed-prices.csv')).rows);

    expect(rows.map((row) => row.minimumPrice)).toEqual([null, null, null, null]);
    expect(rows[0]?.appraisalPrice).toBeNull(); // an empty cell
    expect(rows[1]?.appraisalPrice?.toFixed()).toBe('235000');
  });

  it('finds the header of a list with no rows, and counts none', () => {
    const list = parseCaixaList(readCaixaFixture('lista-empty.csv'));

    expect(listFacts(list)).toEqual({
      headerFound: true,
      missingColumns: [],
      generatedOn: '2025-11-10',
      rowCount: 0,
    });
  });

  it('has no generation date when the line is absent, or the day does not exist', () => {
    expect(parseCaixaList(readCaixaFixture('lista-no-generation-date.csv')).generatedOn).toBeNull();
    expect(
      parseCaixaList(readCaixaFixture('lista-invalid-generation-date.csv')).generatedOn,
    ).toBeNull();
  });

  it('has no generation date when the label has no value after it', () => {
    const csv = 'Data de geração:;;\nN° do imóvel;UF;Cidade;Modalidade de venda\n1;AC;X;Y\n';

    expect(parseCaixaList(csv).generatedOn).toBeNull();
  });

  it('reports an unrecognised layout: no header row, no rows', () => {
    const list = parseCaixaList(readCaixaFixture('lista-unrecognised-layout.csv'));

    expect(list.header).toBeNull();
    expect(list.rows).toEqual([]);
    expect(listFacts(list)).toMatchObject({ headerFound: false, rowCount: 0 });
  });

  it('reports an empty text as an unrecognised layout', () => {
    expect(parseCaixaList('')).toEqual({ rows: [], header: null, generatedOn: null });
    expect(parseCsv('')).toEqual([]);
  });

  it('does not parse the Radware page as a list (TS-12, BR-004-20)', () => {
    const list = parseCaixaList(readCaixaFixture('bot-protection.html'));

    expect(list.header).toBeNull();
    expect(list.rows).toEqual([]);
    // The port refuses this body before it gets here (http-caixa-access.spec.ts); if it ever did
    // arrive, it would still be an unrecognised layout and nothing would be applied.
  });

  it('counts 30% of a list’s rows when it is cut short', () => {
    const [metadata, header, ...body] = readCaixaFixture('Lista_imoveis_geral.csv')
      .split('\n')
      .filter((line) => line.trim() !== '');
    const rows = Array.from({ length: 10 }, (_, i) => body[i % body.length] as string);

    const full = [metadata, header, ...rows].join('\n');
    const truncated = [metadata, header, ...rows.slice(0, 3)].join('\n');

    expect(listFacts(parseCaixaList(full)).rowCount).toBe(10);
    expect(listFacts(parseCaixaList(truncated)).rowCount).toBe(3);
  });
});

describe('normalizeRows property type (BR-004-11 fallback)', () => {
  it('takes the type the description begins with, and null for a description that gives none', () => {
    const rows = normalizeRows(parseCsv(readCaixaFixture('Lista_imoveis_geral.csv')));

    expect(rows.map((row) => row.propertyType)).toEqual(['Terreno', 'Casa', 'Casa', 'Casa']);
    expect(
      normalizeRows([
        { UF: 'AC', Cidade: 'X', 'Modalidade de venda': 'Y', Descrição: 'sem tipo' },
      ])[0]?.propertyType,
    ).toBeNull();
    expect(
      normalizeRows([{ UF: 'AC', Cidade: 'X', 'Modalidade de venda': 'Y' }])[0]?.propertyType,
    ).toBeNull();
  });
});
