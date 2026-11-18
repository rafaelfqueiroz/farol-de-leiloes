// A URL that came from the API (the provider's checkout, billing portal or invoice page) is only
// followed or shown as a link when it is https: a `javascript:` or `http:` value, or text that is
// no URL at all, is no destination.

/** `value` itself when it is an absolute https URL, else null. */
export function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}
