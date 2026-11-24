// SC-10: text that came from a request becomes part of a regular expression only as LITERAL text.
// Every character that means something to a regular expression is escaped, so `.*`, `(a+)+$` or
// `^` typed in a search box match those characters and nothing else, and cannot be made to run long
// (ReDoS). The result is for `$regex` over a field, wrapped by the caller in `serverOperators`
// together with its options.

const SPECIAL = /[.*+?^${}()|[\]\\/-]/g;

export function escapeRegex(text: string): string {
  return text.replace(SPECIAL, '\\$&');
}
