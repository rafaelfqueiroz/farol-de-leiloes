// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from './proxy';

describe('SC-17 request CSP', () => {
  it('replaces caller-controlled nonce and policy with one shared by rendering and the browser', () => {
    const response = proxy(
      new NextRequest('https://faroldosleiloes.com.br/login', {
        headers: {
          'x-nonce': 'attacker',
          'Content-Security-Policy': "script-src 'unsafe-inline'",
          'Content-Security-Policy-Report-Only': "script-src 'unsafe-eval'",
        },
      }),
    );
    const nonce = response.headers.get('x-middleware-request-x-nonce');
    const policy = response.headers.get('Content-Security-Policy');

    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(policy).toContain(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(response.headers.get('x-middleware-request-content-security-policy')).toBe(policy);
    expect(
      response.headers.get('x-middleware-request-content-security-policy-report-only'),
    ).toBeNull();
    expect(policy).not.toContain('attacker');
    expect(policy).not.toContain('unsafe-eval');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });

  it('generates a different 128-bit nonce for every request', () => {
    const request = new NextRequest('https://faroldosleiloes.com.br/login');
    const first = proxy(request).headers.get('x-middleware-request-x-nonce');
    const second = proxy(request).headers.get('x-middleware-request-x-nonce');
    expect(first).not.toBe(second);
  });
});
