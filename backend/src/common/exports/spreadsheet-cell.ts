/**
 * SC-12 / SPEC-010: apply to every untrusted text cell before CSV quoting or XLSX serialization.
 * The apostrophe forces spreadsheet text; CSV delimiters/quotes still belong to the serializer.
 * Keep decimals and identifiers as strings (AR-17), rather than converting them to JS numbers.
 */
export function neutralizeSpreadsheetCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}
