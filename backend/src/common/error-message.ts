/**
 * Text for a caught value, which TypeScript types as `unknown` (DV-02): its `message` when it
 * has a non-empty one, otherwise the value itself as a string. Same output as the
 * `error?.message || error` template interpolation it replaces.
 */
export function errorMessage(error: unknown): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof error.message === 'string' &&
    error.message
  ) {
    return error.message;
  }
  return String(error);
}
