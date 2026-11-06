/**
 * SC-12 / SPEC-010: apply to untrusted CSV text cells before the serializer quotes delimiters.
 * Importers may trim whitespace before interpreting formulas, so inspect the first non-space
 * character too. Prefix the original value to preserve its content, without trimming it.
 * XLSX exports instead use explicit string cells and never populate a formula property; this
 * CSV apostrophe would be visible text in XLSX. Keep decimals as strings (AR-17).
 */
export function neutralizeCsvCell(value: string): string {
  return /^[\t\r\n]|^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}
