import { describe, expect, it } from 'vitest';
import { httpsUrlOrNull } from './safe-url';

describe('httpsUrlOrNull', () => {
  it('passes an https URL through', () => {
    expect(httpsUrlOrNull('https://checkout.stripe.com/c/pay/cs_1')).toBe(
      'https://checkout.stripe.com/c/pay/cs_1',
    );
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'http://checkout.stripe.com/c/pay',
    'data:text/html,<script>alert(1)</script>',
    '//checkout.stripe.com/c/pay',
    '/relative/path',
    'not a url',
    '',
    null,
    undefined,
    42,
    { href: 'https://x.test' },
  ])('refuses %s', (value) => {
    expect(httpsUrlOrNull(value)).toBeNull();
  });
});
