import { downloadCsvAllStates } from '../src/auctions/importer/downloader';
import { parseCsv } from '../src/auctions/importer/parser';

describe('CSV downloader', () => {
  it('downloads and parses CSV successfully', async () => {
    const csv = await downloadCsvAllStates();

    expect(csv).toBeDefined();
    expect(csv.length).toBeGreaterThan(0);
    expect(csv).toContain('Lista de Im');

    const parsed = parseCsv(csv);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);

    // Verify first row has expected fields
    if (parsed.length > 0) {
      const firstRow = parsed[0];
      expect(firstRow).toHaveProperty('UF');
      expect(firstRow).toHaveProperty('Cidade');
      expect(firstRow).toHaveProperty('Modalidade de venda');
    }
  }, 60000); // 60 second timeout for download
});
