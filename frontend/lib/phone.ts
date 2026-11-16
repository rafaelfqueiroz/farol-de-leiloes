// A Brazilian phone number for display. The API stores it as E.164 (BR-001-27: `+5584999991234`);
// the person typed it as `(84) 99999-1234`, so that is how the profile shows it. Pure: no locale,
// no Intl (DS-29 spirit: formatters live in `lib/`).

const BRAZILIAN_E164 = /^\+55(\d{2})(\d{4,5})(\d{4})$/;

/**
 * `+5584999991234` becomes `(84) 99999-1234` (mobile, 11 digits) and `+558432221234` becomes
 * `(84) 3222-1234` (landline, 10 digits). Anything else (nothing, an already formatted number, a
 * foreign or unreadable string) comes back unchanged, and nothing becomes an empty string.
 */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const match = BRAZILIAN_E164.exec(phone);
  if (!match) return phone;
  const [, area, first, last] = match;
  return `(${area}) ${first}-${last}`;
}
