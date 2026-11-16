// SPEC-003 BR-003-10: a missed performance budget blocks the release unless a waiver, with its
// reason, is recorded with the release. The record is one line of the release notes:
//
//   Performance waiver: <reason>
//
// (optionally as a list item, `- Performance waiver: ...`, or in bold; the keyword is not
// case-sensitive; the reason is everything after the colon on that line). An absent line, an
// empty reason and the template's own `<reason>` placeholder are not waivers. Pure, so
// perf/waiver.test.ts drives it; perf/check-waiver.mjs is the command line the workflow runs.

const WAIVER_LINE = /^[\s>*_-]*performance waiver[*_]*\s*:[*_]*\s*(.*?)\s*$/im;
const PLACEHOLDER = /^<[^>]*>$|^(?:tbd|todo|n\/a|none|-+)$/i;

/**
 * The reason of the first valid waiver line in the release notes, or null.
 * @param {string | null | undefined} releaseNotes
 * @returns {string | null}
 */
export function findWaiver(releaseNotes) {
  for (const line of String(releaseNotes ?? '').split(/\r?\n/)) {
    const reason = WAIVER_LINE.exec(line)?.[1];
    if (reason === undefined) continue;
    const text = reason.replace(/[*_]+$/g, '').trim();
    if (text !== '' && !PLACEHOLDER.test(text)) return text;
  }
  return null;
}
