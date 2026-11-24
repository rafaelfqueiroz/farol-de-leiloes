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

/** Why a NO_UPDATE day is not a business day (BR-004-03, BR-004-31). */
export type NonBusinessReason = 'WEEKEND' | 'HOLIDAY';

/** What the run remembers of its day so far (the schedule's RunProgress, SPEC-004 part 3). */
export interface RunProgressRecord {
  listReached: boolean;
  applying: boolean;
  applyFailed: boolean;
  rejection: { generatedOn: string | null; reason: string } | null;
}

export const NO_PROGRESS: Readonly<RunProgressRecord> = {
  listReached: false,
  applying: false,
  applyFailed: false,
  rejection: null,
};

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
  /** Detail collection (BR-004-18..21): totals of the day's passes; zeros until one ran. */
  collection: {
    collected: number;
    failed: number;
    blocked: boolean;
    pages: number;
    requests: number;
  };
  /** Stable codes only (SC-15). */
  failureReasons: string[];
  alertedAt: Date | null;
  updateCompletedAt: Date | null;
  /** When the next attempt is due; null when none is scheduled. */
  nextAttemptAt: Date | null;
  progress: RunProgressRecord;
  /** For NO_UPDATE only: why the day is not a business day. */
  nonBusinessReason: NonBusinessReason | null;
  /** The lease: who holds the run and until when (part 3's overlap guard). */
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
}

export const NO_COUNTS: Readonly<ImportCounts> = { new: 0, changed: 0, unavailable: 0, active: 0 };
