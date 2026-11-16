// @vitest-environment node
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { clientAddressHeaders, validForwardedFor } from './forwarded-for';

describe('validForwardedFor (SC-04)', () => {
  it.each([
    ['a single IPv4 address', '203.0.113.10', '203.0.113.10'],
    ['an IPv6 address', '2001:db8:1:2::1', '2001:db8:1:2::1'],
    ['an IPv4-mapped IPv6 address', '::ffff:203.0.113.10', '::ffff:203.0.113.10'],
    ['a two-hop chain, order kept', '203.0.113.10, 198.51.100.2', '203.0.113.10, 198.51.100.2'],
    ['a chain without spaces', '203.0.113.10,198.51.100.2', '203.0.113.10, 198.51.100.2'],
    ['whitespace around entries', '  203.0.113.10 ,\t2001:db8::7  ', '203.0.113.10, 2001:db8::7'],
    [
      'exactly 5 entries',
      '192.0.2.1, 192.0.2.2, 192.0.2.3, 192.0.2.4, 192.0.2.5',
      '192.0.2.1, 192.0.2.2, 192.0.2.3, 192.0.2.4, 192.0.2.5',
    ],
  ])('forwards %s', (_label, header, expected) => {
    expect(validForwardedFor(header)).toBe(expected);
  });

  it.each([
    ['the header is absent', null],
    ['it is empty', ''],
    ['an entry is not an address', '203.0.113.10, not-an-ip'],
    ['an entry is an IPv4 address out of range', '203.0.113.256'],
    ['an entry carries a port', '203.0.113.10:4000'],
    ['an entry is empty (trailing comma)', '203.0.113.10,'],
    ['an entry is empty (leading comma)', ',203.0.113.10'],
    ['an entry smuggles another header line', '203.0.113.10\r\nX-Evil: 1'],
    ['6 entries', '192.0.2.1, 192.0.2.2, 192.0.2.3, 192.0.2.4, 192.0.2.5, 192.0.2.6'],
  ])('forwards nothing when %s', (_label, header) => {
    expect(validForwardedFor(header)).toBeNull();
  });

  it('forwards nothing for an IPv6 entry with a zone id', () => {
    expect(validForwardedFor('fe80::1%eth0')).toBeNull();
  });

  it('one invalid entry discards the whole chain, valid entries included', () => {
    expect(validForwardedFor('198.51.100.99, bogus, 203.0.113.10')).toBeNull();
  });
});

describe('clientAddressHeaders', () => {
  const requestWith = (headers: Record<string, string>) =>
    new NextRequest('http://localhost:3001/api/auth/login', { method: 'POST', headers });

  it('returns the validated chain as X-Forwarded-For', () => {
    expect(clientAddressHeaders(requestWith({ 'X-Forwarded-For': '203.0.113.10' }))).toEqual({
      'X-Forwarded-For': '203.0.113.10',
    });
  });

  it('returns no header when the chain is absent or invalid', () => {
    expect(clientAddressHeaders(requestWith({}))).toEqual({});
    expect(clientAddressHeaders(requestWith({ 'X-Forwarded-For': 'x' }))).toEqual({});
  });
});
