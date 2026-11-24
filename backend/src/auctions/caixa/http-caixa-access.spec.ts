// SPEC-004 BR-004-18, BR-004-20, SC-24: the HTTP adapter of the CaixaAccess port against a local
// in-process server on the loopback interface (TS-01, TS-07: nothing reaches Caixa). It proves
// the honest identity, the decoding, the stop on every block signal, the timeout and size cap, the
// refusal of foreign URLs, and that nothing is retried.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CAIXA_USER_AGENT } from '../../common/caixa-user-agent.js';
import type { CaixaConfig } from '../../config/caixa.config.js';
import { caixaFixturePath, readCaixaFixture } from '../../../test/support/fixtures.js';
import { readFileSync } from 'node:fs';
import { spyOnLogger } from '../../../test/support/logger-spy.js';
import { CaixaBlockedError, CaixaUnreachableError, CaixaUrlRefusedError } from './caixa-access.js';
import { HttpCaixaAccess } from './http-caixa-access.js';

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

const BASE_CONFIG: CaixaConfig = { requestTimeoutMs: 2000, maxDownloadBytes: 1024 * 1024 };
const LIST_PATH = '/listaweb/Lista_imoveis_geral.csv';

describe('HttpCaixaAccess', () => {
  let server: Server;
  let origin: string;
  let handler: Handler;
  let requests: { url: string; headers: IncomingMessage['headers'] }[];
  const sockets = new Set<Socket>();
  const created: HttpCaixaAccess[] = [];

  function access(config: Partial<CaixaConfig> = {}, siteOrigin = origin): HttpCaixaAccess {
    const adapter = new HttpCaixaAccess({ ...BASE_CONFIG, ...config }, siteOrigin);
    created.push(adapter);
    return adapter;
  }

  beforeEach(async () => {
    requests = [];
    handler = (_request, response) => response.end('ok');
    server = createServer((request, response) => {
      requests.push({ url: request.url ?? '', headers: request.headers });
      handler(request, response);
    });
    server.on('connection', (socket) => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await Promise.all(created.splice(0).map((adapter) => adapter.onModuleDestroy()));
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  describe('downloadList', () => {
    it('asks for the national list with the product’s own user agent, never a browser’s', async () => {
      handler = (_request, response) => response.end('a;b');

      await expect(access().downloadList()).resolves.toBe('a;b');

      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe(LIST_PATH);
      expect(requests[0]?.headers['user-agent']).toBe(CAIXA_USER_AGENT);
      expect(requests[0]?.headers['user-agent']).not.toMatch(/mozilla/i);
    });

    it('decodes the Windows-1252 list without a declared charset, accents intact', async () => {
      const latin1 = readFileSync(caixaFixturePath('Lista_imoveis_geral.latin1.csv'));
      handler = (_request, response) => response.end(latin1);

      const csv = await access().downloadList();

      expect(csv).toContain('Lista de Imóveis da Caixa');
      expect(csv).toContain('RUA IPÊ, N. SN, SN, QD07 LT11');
      expect(csv).not.toContain('�');
    });

    it('decodes with the charset the response declares', async () => {
      handler = (_request, response) => {
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.end(Buffer.from('Endereço;Preço', 'utf8'));
      };

      await expect(access().downloadList()).resolves.toBe('Endereço;Preço');
    });

    it('falls back to Windows-1252 for a charset the runtime does not know', async () => {
      handler = (_request, response) => {
        response.setHeader('Content-Type', 'text/csv; charset=x-no-such-charset');
        response.end(Buffer.from([0x50, 0x72, 0x65, 0xe7, 0x6f]));
      };

      await expect(access().downloadList()).resolves.toBe('Preço');
    });

    it('drops the BOM of a list that declares UTF-8', async () => {
      handler = (_request, response) => {
        response.setHeader('Content-Type', 'text/csv; charset=utf-8');
        response.end(Buffer.from([0xef, 0xbb, 0xbf, 0x61]));
      };

      await expect(access().downloadList()).resolves.toBe('a');
    });

    it('stops on the Radware page served in place of the list, and hands nothing on', async () => {
      handler = (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(readCaixaFixture('bot-protection.html'));
      };

      await expect(access().downloadList()).rejects.toMatchObject({
        name: 'CaixaBlockedError',
        reason: 'CHALLENGE_PAGE',
      });
    });

    it('recognises the challenge page even when it is served as plain text', async () => {
      handler = (_request, response) => response.end(readCaixaFixture('bot-protection.html'));

      await expect(access().downloadList()).rejects.toBeInstanceOf(CaixaBlockedError);
    });
  });

  describe('block signals stop the request and are never retried (BR-004-20, SC-24)', () => {
    // 407 is mapped too, but the Fetch standard turns a 407 into a network error before the
    // adapter sees a status, so it cannot be driven here: it arrives as CaixaUnreachableError.
    it.each([
      [401, 'HTTP_401'],
      [403, 'HTTP_403'],
      [429, 'HTTP_429'],
      [451, 'HTTP_451'],
      [503, 'HTTP_503'],
    ])('answers CaixaBlockedError for HTTP %i', async (status, reason) => {
      handler = (_request, response) => {
        response.statusCode = status;
        response.end('blocked');
      };

      await expect(access().downloadList()).rejects.toMatchObject({
        name: 'CaixaBlockedError',
        reason,
      });
      expect(requests).toHaveLength(1);
    });

    it.each([200, 404, 500, 302])(
      'answers CaixaBlockedError for any HTTP %i that carries a Retry-After',
      async (status) => {
        handler = (_request, response) => {
          response.statusCode = status;
          response.setHeader('Retry-After', '120');
          response.end('later');
        };

        await expect(access().downloadList()).rejects.toMatchObject({
          name: 'CaixaBlockedError',
          reason: 'RETRY_AFTER',
        });
        expect(requests).toHaveLength(1); // never waited out, never retried
      },
    );

    it('reads a 5xx body for a challenge: Radware can answer 503 with its page', async () => {
      handler = (_request, response) => {
        response.statusCode = 503;
        response.setHeader('Content-Type', 'text/html');
        response.end(readCaixaFixture('bot-protection.html'));
      };

      await expect(access().downloadList()).rejects.toMatchObject({
        name: 'CaixaBlockedError',
        reason: 'CHALLENGE_PAGE',
      });
      expect(requests).toHaveLength(1);
    });

    it('reads no more than 64 KiB of a 5xx body, whatever follows', async () => {
      handler = (_request, response) => {
        response.statusCode = 500;
        response.end(`${'x'.repeat(65 * 1024)}Radware Bot Manager`);
      };
      await expect(access().downloadList()).rejects.toMatchObject({
        name: 'CaixaUnreachableError',
        reason: 'HTTP_STATUS',
        status: 500,
      });

      handler = (_request, response) => {
        response.statusCode = 500;
        response.end(`Radware Bot Manager${'x'.repeat(65 * 1024)}`);
      };
      await expect(access().downloadList()).rejects.toMatchObject({ reason: 'CHALLENGE_PAGE' });
    });

    it('does not read a 5xx body that never ends, but stops at the cap', async () => {
      let written = 0;
      handler = (_request, response) => {
        response.statusCode = 502;
        const timer = setInterval(() => {
          written += 16 * 1024;
          response.write(Buffer.alloc(16 * 1024, 0x78));
        }, 1);
        response.on('close', () => clearInterval(timer));
      };

      await expect(access({ requestTimeoutMs: 5000 }).downloadList()).rejects.toMatchObject({
        reason: 'HTTP_STATUS',
        status: 502,
      });
      expect(written).toBeGreaterThan(0);
    });

    it('answers CaixaBlockedError for a challenge page on a detail page', async () => {
      handler = (_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=utf-8');
        response.end(readCaixaFixture('bot-protection.html'));
      };

      await expect(
        access().fetchDetailPage(`${origin}/sistema/detalhe-imovel.asp?hdnimovel=1`),
      ).rejects.toBeInstanceOf(CaixaBlockedError);
      expect(requests).toHaveLength(1);
    });

    it('answers CaixaBlockedError for a challenge page standing where a file should be', async () => {
      handler = (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(readCaixaFixture('bot-protection.html'));
      };

      await expect(
        access().fetchFile(`${origin}/editais/matricula/TO/1.pdf`),
      ).rejects.toBeInstanceOf(CaixaBlockedError);
    });

    it('answers CaixaBlockedError for a redirect away from the site, without following it', async () => {
      const elsewhere = createServer((request, response) => {
        requests.push({ url: `elsewhere${request.url}`, headers: request.headers });
        response.end('should never be asked');
      });
      await new Promise<void>((resolve) => elsewhere.listen(0, '127.0.0.1', resolve));
      const elsewhereOrigin = `http://127.0.0.1:${(elsewhere.address() as AddressInfo).port}`;
      handler = (_request, response) => {
        response.statusCode = 302;
        response.setHeader('Location', `${elsewhereOrigin}/challenge`);
        response.end();
      };

      try {
        await expect(access().downloadList()).rejects.toMatchObject({
          name: 'CaixaBlockedError',
          reason: 'REDIRECT_OFF_SITE',
        });
        expect(requests.map((r) => r.url)).toEqual([LIST_PATH]);
      } finally {
        elsewhere.closeAllConnections();
        await new Promise((resolve) => elsewhere.close(resolve));
      }
    });
  });

  describe('other failures are CaixaUnreachableError (BR-004-21)', () => {
    it.each([404, 500])('answers CaixaUnreachableError for HTTP %i, once', async (status) => {
      handler = (_request, response) => {
        response.statusCode = status;
        response.end('no');
      };

      await expect(access().downloadList()).rejects.toMatchObject({
        name: 'CaixaUnreachableError',
        reason: 'HTTP_STATUS',
        status,
      });
      expect(requests).toHaveLength(1);
    });

    it('answers TIMEOUT when Caixa does not answer in time', async () => {
      handler = () => {
        /* never answers */
      };

      await expect(access({ requestTimeoutMs: 100 }).downloadList()).rejects.toMatchObject({
        name: 'CaixaUnreachableError',
        reason: 'TIMEOUT',
      });
    });

    it('answers TIMEOUT when the body stalls after the headers', async () => {
      handler = (_request, response) => {
        response.write('partial');
      };

      await expect(access({ requestTimeoutMs: 150 }).downloadList()).rejects.toMatchObject({
        reason: 'TIMEOUT',
      });
    });

    it('answers NETWORK when nothing listens, and the message names no address', async () => {
      const closed = createServer();
      await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
      const closedOrigin = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
      await new Promise((resolve) => closed.close(resolve));

      const error = await access({}, closedOrigin)
        .downloadList()
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(CaixaUnreachableError);
      expect(error).toMatchObject({ reason: 'NETWORK' });
      expect((error as Error).message).not.toContain('127.0.0.1');
    });

    it('refuses a body over the size cap, declared or streamed', async () => {
      handler = (_request, response) => response.end(Buffer.alloc(2000));
      await expect(access({ maxDownloadBytes: 1000 }).downloadList()).rejects.toMatchObject({
        name: 'CaixaUnreachableError',
        reason: 'RESPONSE_TOO_LARGE',
      });

      handler = (_request, response) => {
        response.write(Buffer.alloc(600));
        response.write(Buffer.alloc(600));
        response.end();
      };
      await expect(access({ maxDownloadBytes: 1000 }).downloadList()).rejects.toMatchObject({
        reason: 'RESPONSE_TOO_LARGE',
      });
    });

    it('accepts a body of exactly the cap', async () => {
      handler = (_request, response) => response.end(Buffer.alloc(1000, 0x61));

      await expect(access({ maxDownloadBytes: 1000 }).downloadList()).resolves.toHaveLength(1000);
    });
  });

  describe('redirects on the site', () => {
    it('follows a redirect inside the origin', async () => {
      handler = (request, response) => {
        if (request.url === LIST_PATH) {
          response.statusCode = 301;
          response.setHeader('Location', '/listaweb/moved.csv');
          response.end();
        } else {
          response.end('moved;ok');
        }
      };

      await expect(access().downloadList()).resolves.toBe('moved;ok');
      expect(requests.map((r) => r.url)).toEqual([LIST_PATH, '/listaweb/moved.csv']);
    });

    it('gives up on a redirect loop instead of following it forever', async () => {
      handler = (_request, response) => {
        response.statusCode = 302;
        response.setHeader('Location', LIST_PATH);
        response.end();
      };

      await expect(access().downloadList()).rejects.toMatchObject({
        name: 'CaixaUnreachableError',
        reason: 'TOO_MANY_REDIRECTS',
      });
      expect(requests).toHaveLength(4);
    });

    it('treats a redirect with a malformed Location as an unexpected answer, not a TypeError', async () => {
      handler = (_request, response) => {
        response.statusCode = 302;
        response.setHeader('Location', 'http://[::1');
        response.end();
      };

      await expect(access().downloadList()).rejects.toMatchObject({
        name: 'CaixaUnreachableError',
        reason: 'HTTP_STATUS',
        status: 302,
      });
    });

    it('treats a redirect with no Location as an unexpected answer', async () => {
      handler = (_request, response) => {
        response.statusCode = 302;
        response.end();
      };

      await expect(access().downloadList()).rejects.toMatchObject({
        reason: 'HTTP_STATUS',
        status: 302,
      });
    });
  });

  describe('fetchDetailPage and fetchFile stay on Caixa’s own site (SC-24)', () => {
    it('reads a page by absolute or relative URL, with the honest identity', async () => {
      handler = (_request, response) => {
        response.setHeader('Content-Type', 'text/html; charset=iso-8859-1');
        response.end(Buffer.from('<p>Endere\xe7o</p>', 'latin1'));
      };

      await expect(
        access().fetchDetailPage(`${origin}/sistema/detalhe-imovel.asp?hdnimovel=1`),
      ).resolves.toBe('<p>Endereço</p>');
      await expect(
        access().fetchDetailPage('/sistema/detalhe-imovel.asp?hdnimovel=2'),
      ).resolves.toBe('<p>Endereço</p>');

      expect(requests.map((r) => r.url)).toEqual([
        '/sistema/detalhe-imovel.asp?hdnimovel=1',
        '/sistema/detalhe-imovel.asp?hdnimovel=2',
      ]);
      expect(requests.every((r) => r.headers['user-agent'] === CAIXA_USER_AGENT)).toBe(true);
    });

    it('reads the charset a page declares in a meta tag', async () => {
      handler = (_request, response) => {
        response.setHeader('Content-Type', 'text/html');
        response.end(Buffer.from('<meta charset="utf-8"><p>Endereço</p>', 'utf8'));
      };

      await expect(access().fetchDetailPage('/p')).resolves.toBe(
        '<meta charset="utf-8"><p>Endereço</p>',
      );
    });

    it.each([
      'https://example.com/detalhe',
      'http://169.254.169.254/latest/meta-data',
      '//example.com/x',
      'http://[::1',
      'https://user:secret@venda-imoveis.caixa.gov.br/x',
      'https://venda-imoveis.caixa.gov.br.evil.example/x',
      'https://venda-imoveis.caixa.gov.br@evil.example/x',
      'https://@evil.example/x',
      'https://venda-imoveis.caixa.gov.br:8443/x',
      'https://evil.example\\@venda-imoveis.caixa.gov.br/x',
      'http://venda-imoveis.caixa.gov.br/x',
    ])('refuses %s without sending any request', async (url) => {
      // The default origin: Caixa's own. The refusal happens before anything is sent.
      const caixa = new HttpCaixaAccess(BASE_CONFIG);
      created.push(caixa);

      await expect(caixa.fetchDetailPage(url)).rejects.toBeInstanceOf(CaixaUrlRefusedError);
      await expect(caixa.fetchFile(url)).rejects.toBeInstanceOf(CaixaUrlRefusedError);
      expect(requests).toEqual([]);
    });

    it('refuses credentials in a URL on the origin itself', async () => {
      const withUserinfo = origin.replace('http://', 'http://user:secret@');

      await expect(access().fetchDetailPage(`${withUserinfo}/p`)).rejects.toBeInstanceOf(
        CaixaUrlRefusedError,
      );
      expect(requests).toEqual([]);
    });

    it('returns a file’s bytes and what Caixa said it is', async () => {
      const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff]);
      handler = (_request, response) => {
        response.setHeader('Content-Type', 'application/pdf');
        response.end(pdf);
      };

      const file = await access().fetchFile('/editais/matricula/TO/1.pdf');

      expect(file.body.equals(pdf)).toBe(true);
      expect(file.contentType).toBe('application/pdf');
    });

    it('stops on a block while fetching a file, and does not retry', async () => {
      handler = (_request, response) => {
        response.statusCode = 429;
        response.end();
      };

      await expect(access().fetchFile('/fotos/F1.jpg')).rejects.toMatchObject({
        reason: 'HTTP_429',
      });
      expect(requests).toHaveLength(1);
    });

    it('reports a missing file as unreachable with its status, so the caller can tell', async () => {
      handler = (_request, response) => {
        response.statusCode = 404;
        response.end();
      };

      await expect(access().fetchFile('/fotos/F1.jpg')).rejects.toMatchObject({
        reason: 'HTTP_STATUS',
        status: 404,
      });
    });
  });

  describe('the optional proxy (CAIXA_PROXY_URL, ADR-003)', () => {
    it('sends the request through the configured http proxy, with the same identity', async () => {
      const tunnelled: string[] = [];
      const proxy = createServer();
      const tunnels = new Set<{ destroy(): unknown }>();
      proxy.on('connect', (request, clientSocket) => {
        tunnels.add(clientSocket);
        tunnelled.push(request.url ?? '');
        const target = new URL(`http://${request.url}`);
        void import('node:net').then(({ connect }) => {
          const upstream = connect(Number(target.port), target.hostname, () => {
            clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            upstream.pipe(clientSocket);
            clientSocket.pipe(upstream);
          });
          upstream.on('error', () => clientSocket.destroy());
          clientSocket.on('error', () => upstream.destroy());
        });
      });
      await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
      const proxyUrl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
      handler = (_request, response) => response.end('via;proxy');

      try {
        await expect(access({ proxyUrl }).downloadList()).resolves.toBe('via;proxy');
        expect(tunnelled).toEqual([new URL(origin).host]);
        expect(requests[0]?.headers['user-agent']).toBe(CAIXA_USER_AGENT);
      } finally {
        for (const tunnel of tunnels) tunnel.destroy();
        proxy.closeAllConnections();
        await new Promise((resolve) => proxy.close(resolve));
      }
    });

    it('says at boot that a proxy is set, and never prints it (SC-16, SC-24)', () => {
      const logger = spyOnLogger();
      created.push(
        new HttpCaixaAccess({
          ...BASE_CONFIG,
          proxyUrl: 'http://user:hunter2@proxy.example.test:3128',
        }),
      );
      created.push(new HttpCaixaAccess(BASE_CONFIG));

      expect(logger.loggedText()).toContain('CAIXA_PROXY_URL is set');
      expect(logger.loggedText()).not.toContain('hunter2');
      expect(logger.loggedText()).not.toContain('proxy.example.test');
      // Only the proxied adapter said it.
      expect(logger.loggedText().match(/CAIXA_PROXY_URL is set/g)).toHaveLength(1);
    });

    it('is a failure, never a fall back to a direct connection, when the proxy is down', async () => {
      const closed = createServer();
      await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
      const proxyUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`;
      await new Promise((resolve) => closed.close(resolve));

      await expect(access({ proxyUrl }).downloadList()).rejects.toMatchObject({
        name: 'CaixaUnreachableError',
        reason: 'NETWORK',
      });
      expect(requests).toEqual([]);
    });
  });
});
