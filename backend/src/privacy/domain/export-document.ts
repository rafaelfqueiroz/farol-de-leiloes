// SPEC-010 BR-010-08, BR-010-09: the shape of the document that is both the export file and the "my
// data" answer: `{ schemaVersion, generatedAt, <provider name>: <what it holds>, ... }`. Pure (AR-05).

/** Bumped when the shape of the envelope changes in a way a reader of the file would notice. */
export const EXPORT_SCHEMA_VERSION = 1;

/** The keys the envelope owns: no provider may be called one of them (the registry refuses it). */
export const EXPORT_RESERVED_KEYS = ['schemaVersion', 'generatedAt'] as const;

export interface ExportDocument {
  readonly schemaVersion: number;
  /** ISO-8601 instant (UTC) the document was put together. */
  readonly generatedAt: string;
  readonly [section: string]: unknown;
}

/**
 * Puts the providers' sections under the envelope. The envelope's keys come last, so nothing a
 * section holds can replace the version or the instant (the registry also refuses such names).
 */
export function buildExportDocument(
  generatedAt: Date,
  sections: Readonly<Record<string, unknown>>,
): ExportDocument {
  return {
    ...sections,
    schemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: generatedAt.toISOString(),
  };
}

/** How many records of each list "my data" shows; the rest is in the export (BR-010-08). */
export const MY_DATA_LIST_LIMIT = 200;

/**
 * A list section for a provider that read at most `limit` records out of `total`: `{ items }` when
 * nothing was cut, and `{ items, truncated: true, totals: { items: total } }` when something was,
 * so the interface can say "showing 200 of 1 340, ask for the export".
 */
export function listSection<T>(items: readonly T[], total: number): Record<string, unknown> {
  return items.length >= total ? { items } : { items, truncated: true, totals: { items: total } };
}

/**
 * The safety net of "my data" over every provider: any list directly inside a section that is still
 * longer than `limit` is cut to its first `limit` entries and the section says so
 * (`truncated: true`, `totals: { <list>: <length before the cut> }`, merged with what the provider
 * already reported). Sections that are not plain objects pass through. The export never calls this:
 * it is complete.
 */
export function capSections(
  sections: Readonly<Record<string, unknown>>,
  limit: number,
): Record<string, unknown> {
  const capped: Record<string, unknown> = {};
  for (const [name, section] of Object.entries(sections)) {
    if (typeof section !== 'object' || section === null || Array.isArray(section)) {
      capped[name] = section;
      continue;
    }
    const entries = Object.entries(section as Record<string, unknown>);
    const cut: Record<string, unknown> = {};
    const totals: Record<string, number> = {
      ...((section as { totals?: Record<string, number> }).totals ?? {}),
    };
    let truncated = (section as { truncated?: boolean }).truncated === true;
    for (const [key, value] of entries) {
      if (Array.isArray(value) && value.length > limit) {
        cut[key] = value.slice(0, limit);
        totals[key] = value.length;
        truncated = true;
      } else {
        cut[key] = value;
      }
    }
    capped[name] = truncated ? { ...cut, truncated: true, totals } : cut;
  }
  return capped;
}
