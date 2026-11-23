// SPEC-009 BR-009-11 (#144): the one HTML escaper. Hand-computed expectations (TS-04).
import { describe, expect, it } from 'vitest';
import { escapeHtml, escapeHtmlWithLineBreaks } from './escape-html.js';

describe('escapeHtml', () => {
  it('turns each of the five characters into its entity', () => {
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml("'")).toBe('&#39;');
  });

  it('escapes the ampersand first, so an entity typed by the user is shown as typed', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves markup as literal text', () => {
    expect(escapeHtml('<b>teste</b><script>x()</script>')).toBe(
      '&lt;b&gt;teste&lt;/b&gt;&lt;script&gt;x()&lt;/script&gt;',
    );
    expect(escapeHtml('<a href="https://x.example.test/?a=1&b=2">y</a>')).toBe(
      '&lt;a href=&quot;https://x.example.test/?a=1&amp;b=2&quot;&gt;y&lt;/a&gt;',
    );
  });

  it('leaves plain text, accents and an empty string alone', () => {
    expect(escapeHtml('Olá, ação São João')).toBe('Olá, ação São João');
    expect(escapeHtml('')).toBe('');
  });
});

describe('escapeHtmlWithLineBreaks', () => {
  it('adds a <br> per line break after escaping, for LF, CRLF and CR alike', () => {
    expect(escapeHtmlWithLineBreaks('a\nb\r\nc\rd')).toBe('a<br>b<br>c<br>d');
  });

  it('keeps typed markup literal while the breaks stay real', () => {
    expect(escapeHtmlWithLineBreaks('<i>um</i>\n<u>dois</u>')).toBe(
      '&lt;i&gt;um&lt;/i&gt;<br>&lt;u&gt;dois&lt;/u&gt;',
    );
  });
});
