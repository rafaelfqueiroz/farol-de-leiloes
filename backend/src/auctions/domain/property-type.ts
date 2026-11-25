// SPEC-004 BR-004-11: the property type. The detail page states it; until it has been collected,
// the list's description begins with it ("Casa, 94.28 de área privativa, ..."), which is the
// fallback. A description that does not begin that way gives null: unknown, never a guess
// (BR-004-15).

const LEADING_TYPE = /^(\p{L}[\p{L} ]{1,29}),/u;

/**
 * "Casa, 0.00 de área total" -> "Casa"; "APARTAMENTO, 62 m2" -> "Apartamento"; null when the
 * description is absent or does not start with a word followed by a comma.
 */
export function propertyTypeFromDescription(description: string | null | undefined): string | null {
  const match = LEADING_TYPE.exec((description ?? '').trim());
  const word = match?.[1]?.trim();
  if (!word) return null;
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
