// @vitest-environment node
import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { NextRequest } from 'next/server';
import { NodeNextRequest, NodeNextResponse } from 'next/dist/server/base-http/node';
import RenderResult from 'next/dist/server/render-result';
import { sendRenderResult } from 'next/dist/server/send-payload';
import { sendResponse } from 'next/dist/server/send-response';
import { describe, expect, it } from 'vitest';
import { proxy } from '@/proxy';

// SC-17, TS-01: exercise the installed Next response senders without listening on
// a port or starting an application. They must receive no early cache override.
function responseAfterProxy(path: string): { request: IncomingMessage; response: ServerResponse } {
  const request = new IncomingMessage(new Socket());
  request.method = 'HEAD';
  request.url = path;
  const response = new ServerResponse(request);
  const proxyResponse = proxy(new NextRequest(`https://faroldosleiloes.com.br${path}`));
  proxyResponse.headers.forEach((value, name) => {
    if (!name.startsWith('x-middleware-')) response.setHeader(name, value);
  });
  return { request, response };
}

describe('SC-17 Next cache headers after the proxy', () => {
  it.each([
    ['/icon.svg', 'public, max-age=31536000, immutable'],
    ['/brand/farol-mark.svg', 'public, max-age=0'],
    ['/robots.txt', 'public, max-age=0, must-revalidate'],
    ['/sitemap.xml', 's-maxage=3600, stale-while-revalidate=31532400'],
  ])('preserves the route cache policy for %s', async (path, cacheControl) => {
    const { request, response } = responseAfterProxy(path);
    await sendResponse(
      new NodeNextRequest(request),
      new NodeNextResponse(response),
      new Response(null, { headers: { 'Cache-Control': cacheControl } }),
    );
    expect(String(response.getHeader('Cache-Control'))).toBe(cacheControl);
    request.destroy();
  });

  it.each(['/login', '/api/does-not-exist', '/brand/missing.svg'])(
    'allows dynamic HTML and HTML errors at %s to remain private and unstored',
    async (path) => {
      const { request, response } = responseAfterProxy(path);
      await sendRenderResult({
        req: request,
        res: response,
        result: RenderResult.fromStatic('<html></html>', 'text/html; charset=utf-8'),
        generateEtags: false,
        poweredByHeader: false,
        cacheControl: { revalidate: 0, expire: undefined },
      });
      expect(response.getHeader('Cache-Control')).toBe(
        'private, no-cache, no-store, max-age=0, must-revalidate',
      );
      expect(response.getHeader('Content-Security-Policy')).toMatch(/'nonce-[A-Za-z0-9+/]+=*'/);
      request.destroy();
    },
  );
});
