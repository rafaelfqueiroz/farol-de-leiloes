// Issue #144 ("every email template"): the account name is text a person typed, so the verification
// and password reset emails show it as plain text, never as markup. Regression: both interpolated it
// raw. Fake values only (TS-27).
import { describe, expect, it } from 'vitest';
import {
  getPasswordResetEmailTemplate,
  getVerificationEmailTemplate,
} from './verification.template.js';

const NAME = '<img src=x onerror=alert(1)><script>alert(2)</script>"\'&';
const ESCAPED =
  '&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;alert(2)&lt;/script&gt;&quot;&#39;&amp;';

describe.each([
  [
    'verification',
    getVerificationEmailTemplate,
    'https://example.test/verify-email/token-ficticio',
  ],
  [
    'password reset',
    getPasswordResetEmailTemplate,
    'https://example.test/reset-password/token-ficticio',
  ],
])('the %s email (#144)', (_kind, template, url) => {
  it('shows the account name as literal text', () => {
    const html = template(NAME, url);

    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).toContain(`<strong>${ESCAPED}</strong>`);
  });

  it('keeps its link and its layout', () => {
    const html = template('Fulana Ficticia', url);

    expect(html).toContain('<p>Ola, <strong>Fulana Ficticia</strong>!</p>');
    expect(html).toContain(`href="${url}"`);
    expect(html).toContain(`<p class="link-text">${url}</p>`);
  });
});
