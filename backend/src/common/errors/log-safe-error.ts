/**
 * A stable identifier for a caught value that is safe to log or store (SC-15, AR-46), never its
 * message: provider errors quote their input (Twilio: "The 'To' number +55... is not valid", SMTP
 * errors quote addresses). It is the error's `code` when that is a string or a number, else the
 * error class name, else 'UNKNOWN_ERROR'.
 *
 * NOTE: PR #93 adds a similar `jobErrorCode`; the two may be merged later.
 */
export function logSafeError(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code) return code;
    if (typeof code === 'number' && Number.isFinite(code)) return String(code);
    const name = error.constructor?.name;
    if (name && name !== 'Object') return name;
  }
  return 'UNKNOWN_ERROR';
}
