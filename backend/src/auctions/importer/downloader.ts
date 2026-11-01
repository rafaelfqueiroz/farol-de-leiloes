import { exec } from 'child_process';
import { promisify } from 'util';
import { errorMessage } from '../../common/error-message';

const execAsync = promisify(exec);

// Download CSV file directly using the static URL pattern from the website
// Using curl because the Node.js HTTPS client is blocked by bot protection
export async function downloadCsvAllStates(): Promise<string> {
  // The website uses a static URL pattern: /listaweb/Lista_imoveis_{estado}.csv
  // For all states, use 'geral'
  const estado = 'geral';
  const url = `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${estado}.csv`;

  try {
    // Use curl to bypass bot protection - it works while Node.js https doesn't
    // The CSV is in Windows-1252/ISO-8859-1 encoding, so we convert it to UTF-8 using iconv
    const { stdout } = await execAsync(
      `curl -L "${url}" -H "User-Agent: Mozilla/5.0" --max-time 30 | iconv -f ISO-8859-1 -t UTF-8`,
      { maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }, // 20MB max
    );
    return stdout;
  } catch (error) {
    throw new Error(`Failed to download CSV: ${errorMessage(error)}`);
  }
}
