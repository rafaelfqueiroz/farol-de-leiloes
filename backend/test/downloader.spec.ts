import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { downloadCsvAllStates } from '../src/auctions/importer/downloader';
import { parseCsv } from '../src/auctions/importer/parser';

// TS-07 / TS-28: the downloader never reaches the live Caixa site in tests.
// `child_process.exec` is the only I/O boundary of the downloader (it shells out to
// `curl ... | iconv`) and has no port, so it is the one module stubbed here (TS-03).
// Only the `curl` stage is replaced: the stub feeds a captured fixture into the very
// same pipeline, so the real `iconv` ISO-8859-1 -> UTF-8 decoding and the real parser
// still run.
jest.mock('child_process', () => {
  const { promisify: realPromisify } = jest.requireActual<typeof import('util')>('util');
  const fake = jest.fn();
  // Mirror the real `exec`, whose promisified form resolves `{ stdout, stderr }`.
  (fake as unknown as Record<symbol, unknown>)[realPromisify.custom] = (
    command: string,
    options: unknown,
  ) =>
    new Promise((resolve, reject) => {
      fake(command, options, (error: Error | null, result: unknown) =>
        error ? reject(error) : resolve(result),
      );
    });
  return { exec: fake };
});

const FIXTURES = path.join(__dirname, 'fixtures');
const CAIXA_CSV_LATIN1 = path.join(FIXTURES, 'caixa', 'Lista_imoveis_geral.latin1.csv');
const BOT_PROTECTION_HTML = path.join(FIXTURES, 'bot-protection.html');

const execMock = exec as unknown as jest.Mock;
const realExecAsync = promisify(
  jest.requireActual<typeof import('child_process')>('child_process').exec,
);

// Replays `body` instead of `curl`: the command's first pipeline stage (curl) is swapped
// for `cat <fixture>` and the remaining stages (iconv) run for real. Returns the commands
// that were actually executed so a test can prove curl was never started.
function replayInsteadOfCurl(bodyFile: string): string[] {
  const executed: string[] = [];
  execMock.mockImplementation(
    (
      command: string,
      options: object,
      callback: (error: Error | null, result?: unknown) => void,
    ) => {
      const firstPipe = command.indexOf(' | ');
      const rest = command.slice(firstPipe + 3);
      const offlineCommand = `cat "${bodyFile}" | ${rest}`;
      executed.push(offlineCommand);
      realExecAsync(offlineCommand, options).then(
        (result) => callback(null, result),
        (error: Error) => callback(error),
      );
    },
  );
  return executed;
}

describe('CSV downloader (offline, Caixa fixture)', () => {
  it('downloads the Caixa CSV through curl|iconv and the parser reads the decoded rows', async () => {
    const executed = replayInsteadOfCurl(CAIXA_CSV_LATIN1);

    const csv = await downloadCsvAllStates();

    // The boundary was hit exactly once, for the static "geral" list URL.
    expect(execMock).toHaveBeenCalledTimes(1);
    const [issuedCommand, issuedOptions] = execMock.mock.calls[0] as [string, { encoding: string }];
    expect(issuedCommand).toContain(
      'https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_geral.csv',
    );
    expect(issuedOptions.encoding).toBe('utf8');
    // The replayed pipeline never started curl, so no request left the machine.
    expect(executed).toHaveLength(1);
    expect(executed[0]).not.toContain('curl');

    // The fixture is ISO-8859-1 on disk (0xE1 for "á", 0xF3 for "ó"); the real iconv
    // step must have turned it into UTF-8 text with the accents intact.
    expect(fs.readFileSync(CAIXA_CSV_LATIN1).includes(0xf3)).toBe(true);
    expect(csv).toContain('Lista de Imóveis da Caixa');
    expect(csv).not.toContain('�');

    const rows = parseCsv(csv);

    // Preamble line and blank line skipped; the 4 property rows of the fixture remain.
    expect(rows).toHaveLength(4);

    // Second property row, read by hand from the fixture file.
    expect(rows[1]).toMatchObject({
      'N° do imóvel': '1444418010407',
      UF: 'TO',
      Cidade: 'PARAISO DO TOCANTINS',
      Bairro: 'LOT J PAULISTA',
      Endereço: 'RUA CAMPOS SALES, N. SN, LT07C PARTE DO LT 07A QD36',
      Preço: '235.000,00',
      'Valor de avaliação': '235.000,00',
      Desconto: '0.00',
      'Modalidade de venda': 'Leilão SFI - Edital único',
      'Link de acesso':
        'https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdnimovel=1444418010407',
    });

    // Last row carries a non-ASCII street name (ISO-8859-1 0xCA = "Ê").
    expect(rows[3]).toMatchObject({
      'N° do imóvel': '1555520758344',
      UF: 'TO',
      Cidade: 'SANTA FE DO ARAGUAIA',
      Endereço: 'RUA IPÊ, N. SN, SN, QD07 LT11',
      'Modalidade de venda': 'Venda Direta Online',
    });
  });

  it('yields no rows when Caixa serves the bot-protection page instead of the CSV', async () => {
    replayInsteadOfCurl(BOT_PROTECTION_HTML);

    const body = await downloadCsvAllStates();

    // The downloader does not detect the challenge today: it returns the HTML as text.
    expect(body).toContain('Radware Bot Manager CAPTCHA');
    // ...and the parser finds no UF/Cidade/Modalidade header in it, so nothing is imported.
    expect(parseCsv(body)).toEqual([]);
  });

  it('wraps a failed download in "Failed to download CSV"', async () => {
    execMock.mockImplementation(
      (_command: string, _options: object, callback: (error: Error) => void) => {
        callback(new Error('curl: (28) Operation timed out'));
      },
    );

    await expect(downloadCsvAllStates()).rejects.toThrow(
      'Failed to download CSV: curl: (28) Operation timed out',
    );
  });
});
