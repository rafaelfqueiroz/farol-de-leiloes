/**
 * The `message` of whatever was thrown, or an empty string when it carries none. Lets a `catch`
 * clause keep its `unknown` type (DV-02) and still write `errorMessage(error) || 'fallback'`.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) {
    return typeof error.message === 'string' ? error.message : '';
  }
  return '';
}
