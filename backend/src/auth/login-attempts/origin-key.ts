// SC-04 / BR-001-15: the origin of a request as the throttle keys it. A caller must not shed its
// counter by changing form: IPv4 reaches Express as `::ffff:a.b.c.d` on a dual-stack socket, and a
// single IPv6 subscriber controls a whole /64, so 2^64 addresses would otherwise be 2^64 buckets.
//
//   ::ffff:203.0.113.7                → 203.0.113.7
//   203.0.113.7                       → 203.0.113.7
//   2001:db8:1:2:aaaa:bbbb:cccc:dddd  → 2001:db8:1:2::/64
//   2001:db8::1                       → 2001:db8:0:0::/64
//   anything that is not an address   → unknown

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isIPv4(text: string): boolean {
  const match = IPV4.exec(text);
  return match !== null && match.slice(1).every((octet) => Number(octet) <= 255);
}

/** The eight 16-bit groups of an IPv6 address, or null if it is not one. */
function hextets(address: string): number[] | null {
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups = part.split(':');
    // A trailing dotted quad stands for the last two groups.
    const last = groups[groups.length - 1] ?? '';
    if (last.includes('.')) {
      if (!isIPv4(last)) return null;
      const [a, b, c, d] = last.split('.').map(Number) as [number, number, number, number];
      groups.splice(groups.length - 1, 1, ((a << 8) | b).toString(16), ((c << 8) | d).toString(16));
    }
    const values = groups.map((group) =>
      /^[0-9a-f]{1,4}$/i.test(group) ? parseInt(group, 16) : NaN,
    );
    return values.some(Number.isNaN) ? null : values;
  };
  const head = parse(halves[0] ?? '');
  const tail = halves.length === 2 ? parse(halves[1] ?? '') : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  // `::` stands for at least one group of zeros.
  return missing < 1 ? null : [...head, ...Array<number>(missing).fill(0), ...tail];
}

export function normalizeOrigin(ip: string | undefined): string {
  if (typeof ip !== 'string') return 'unknown';
  const address = ip.trim().split('%')[0] ?? ''; // drop an IPv6 zone id
  if (isIPv4(address)) return address;
  const groups = hextets(address);
  if (!groups) return 'unknown';
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  // IPv4-mapped (::ffff:a.b.c.d, or the same in hex): the IPv4 address it carries.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return `${g6 >> 8}.${g6 & 0xff}.${g7 >> 8}.${g7 & 0xff}`;
  }
  return `${[g0, g1, g2, g3].map((group) => group.toString(16)).join(':')}::/64`;
}
