// SPEC-010 BR-010-28: the label a person keeps inside one journey after their account is deleted or
// they leave an office. Pure (AR-05): the random bytes come in as an argument (the service draws
// them from the system's CSPRNG), so the function derives nothing from any user data.

/** 128 bits at least (SC-06 asks for the same of any token): 16 random bytes. */
export const PSEUDONYM_MIN_BYTES = 16;

/**
 * The pseudonym as text: `p-` and the bytes in lower-case hexadecimal. It carries nothing of the
 * person, only the randomness it was made from, so it cannot be traced back once the link to the
 * account is cut (BR-010-28). Fewer than 16 bytes is a programming error, never a weaker label.
 */
export function pseudonymFromBytes(bytes: Uint8Array): string {
  if (bytes.length < PSEUDONYM_MIN_BYTES) {
    throw new RangeError(`A pseudonym needs at least ${PSEUDONYM_MIN_BYTES} random bytes`);
  }
  return `p-${Buffer.from(bytes).toString('hex')}`;
}
