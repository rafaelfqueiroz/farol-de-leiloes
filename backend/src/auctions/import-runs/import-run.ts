// SPEC-004 BR-004-27: what an Import Run is, in code. A plain shape the services answer with
// (AR-09: other modules never see the persistence schema).

export const IMPORT_OUTCOMES = [
  'RUNNING',
  'SUCCESS',
  'FAILED',
  'REJECTED_LIST',
  'NO_NEW_LIST',
  'NO_UPDATE',
] as const;
export type ImportOutcome = (typeof IMPORT_OUTCOMES)[number];

/** BR-004-27: counts of the properties the run touched, and of those active afterwards. */
export interface ImportCounts {
  new: number;
  changed: number;
  unavailable: number;
  active: number;
}

export interface ImportRunRecord {
  id: string;
  /** The Brasília calendar day of the run, `YYYY-MM-DD` (AR-22): one run per day. */
  brasiliaDate: string;
  startedAt: Date;
  finishedAt: Date | null;
  outcome: ImportOutcome;
  /** The Brasília day the list was generated, `YYYY-MM-DD` (AR-22); null when no list was read. */
  listGeneratedAt: string | null;
  listRows: number;
  attempts: number;
  counts: ImportCounts;
  /** Detail collection (part 3); zeros until then. */
  collection: { collected: number; failed: number; blocked: boolean };
  /** Stable codes only (SC-15). */
  failureReasons: string[];
  alertedAt: Date | null;
  updateCompletedAt: Date | null;
}

export const NO_COUNTS: Readonly<ImportCounts> = { new: 0, changed: 0, unavailable: 0, active: 0 };
