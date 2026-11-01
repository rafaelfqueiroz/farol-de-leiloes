import * as fs from 'fs';
import * as path from 'path';
import { parseCsv, normalizeRows } from '../src/auctions/importer/parser';

describe('CSV parser', () => {
  it('parses Lista_imoveis_geral.csv and returns 4 rows', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'Lista_imoveis_geral.csv');
    const csv = fs.readFileSync(fixturePath, 'utf8');
    const rows = parseCsv(csv);
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(4);
  });

  it('normalizes rows and extracts all required fields', () => {
    const fixturePath = path.join(__dirname, 'fixtures', 'Lista_imoveis_geral.csv');
    const csv = fs.readFileSync(fixturePath, 'utf8');
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
});
