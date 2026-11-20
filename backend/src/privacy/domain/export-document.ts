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
