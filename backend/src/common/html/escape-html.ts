// SPEC-009 BR-009-11 (#144): text a user typed is shown as plain text, never interpreted as markup.
// The one HTML escaper of the API: every template that puts user-typed text into an html part goes
// through it. Pure (AR-05 spirit): no framework, no I/O.

/** Escapes the five characters that can open markup or end an attribute value. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Escapes `text` and turns its line breaks into `<br>`. The breaks are added AFTER the escaping, so
 * they are the only markup in the result. CRLF and a lone CR count as one break.
 */
export function escapeHtmlWithLineBreaks(text: string): string {
  return escapeHtml(text).replaceAll(/\r\n|\r|\n/g, '<br>');
}
