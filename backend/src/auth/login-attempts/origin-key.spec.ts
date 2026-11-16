// SC-04: the throttle's origin key. Expectations are worked out by hand (TS-04): the groups of an
// IPv6 address are 16-bit hex numbers, the first four of eight make the /64 the key names.
import { describe, expect, it } from 'vitest';
import { normalizeOrigin } from './origin-key.js';

describe('normalizeOrigin', () => {
  it.each([
    // IPv4 stays as it is.
    ['203.0.113.7', '203.0.113.7'],
    // IPv4-mapped, as an IPv4 client reaches a dual-stack socket: the IPv4 it carries.
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    // The same mapped address in hex: cb00:7107 = 203.0 . 113.7 (0xcb=203, 0x00=0, 0x71=113, 0x07=7).
    ['::ffff:cb00:7107', '203.0.113.7'],
    ['0:0:0:0:0:ffff:cb00:7107', '203.0.113.7'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });

  it.each([
    // Full address: first four groups.
    ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
    // `::` stands for the missing zero groups: 2001:db8:0:0:0:0:0:1 → 2001:db8:0:0.
    ['2001:db8::1', '2001:db8:0:0::/64'],
    // Leading zeros and capitals are not part of the identity.
    ['2001:0DB8:0001:0002::1', '2001:db8:1:2::/64'],
    // A leading `::` : 0:0:0:0:0:0:0:1 → loopback /64 is 0:0:0:0.
    ['::1', '0:0:0:0::/64'],
    // `::` in the middle of the first four groups: 2001:0:0:0:0:0:0:5 → 2001:0:0:0.
    ['2001::5', '2001:0:0:0::/64'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeOrigin(input)).toBe(expected);
  });

  it('puts every address of one /64 in one bucket and different /64s in different ones', () => {
    const a = normalizeOrigin('2001:db8:1:2::1');
    const b = normalizeOrigin('2001:db8:1:2:ffff:ffff:ffff:ffff');
    const c = normalizeOrigin('2001:db8:1:3::1');

    expect(a).toBe(b);
    expect(c).not.toBe(a);
  });

  it('ignores an IPv6 zone id', () => {
    expect(normalizeOrigin('fe80::1%eth0')).toBe('fe80:0:0:0::/64');
  });

  it.each([
    undefined,
    '',
    'not an address',
    '999.1.1.1',
    '1.2.3',
    '2001:db8::1::2',
    '2001:db8:1:2:3:4:5:6:7',
    '2001:db8:1:2:3:4:5',
    '2001:zz::1',
    '1:2:3:4:5:6:7::8',
  ])('%j is "unknown", never a thrown error', (input) => {
    expect(normalizeOrigin(input)).toBe('unknown');
  });
});
