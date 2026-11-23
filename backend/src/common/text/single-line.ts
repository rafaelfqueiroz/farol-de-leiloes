// SPEC-009 BR-009-05, BR-009-10 (security review of #186): a field that is ONE line of text (a subject, a
// name) never carries a line break, a control character or a bidirectional override. In a plain-text
// email a line break lets the writer forge a whole line of the mail ("Solicitante: ..."), and a
// bidi override reorders what the reader sees. Pure (AR-05): no framework, no I/O.

/** C0 and C1 controls (`\p{Cc}`, line breaks and tabs included), line and paragraph separators, bidi marks, embeddings, overrides and isolates. */
const UNSAFE_IN_ONE_LINE = /[\p{Cc}\u2028\u2029\u200E\u200F\u061C\u202A-\u202E\u2066-\u2069]/gu;

/** `text` as one line: each unsafe character becomes a space, runs of white space collapse, the ends are trimmed. */
export function singleLine(text: string): string {
  return text.replace(UNSAFE_IN_ONE_LINE, ' ').replace(/\s+/g, ' ').trim();
}
