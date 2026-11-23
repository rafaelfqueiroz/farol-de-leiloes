// SPEC-004 BR-004-25, BR-004-26: the change entries a run records per property. Pure (AR-05).

export const CHANGE_TYPES = [
  'NEW',
  'RETURNED',
  'BECAME_UNAVAILABLE',
  'PRICE_DROPPED',
  'PRICE_RAISED',
  'STARTED_FINANCING',
  'STARTED_FGTS',
  'STOPPED_FINANCING',
  'STOPPED_FGTS',
  'MODALITY_OR_ROUND_CHANGED',
  'NEW_DATE',
  'OTHER_FIELD',
] as const;
export type ChangeType = (typeof CHANGE_TYPES)[number];

export const CHANGE_SOURCES = ['LIST', 'DETAILS', 'CLOCK'] as const;
export type ChangeSource = (typeof CHANGE_SOURCES)[number];

/** The values an entry holds: money as a decimal string (AR-17), a flag, a text, or nothing. */
export type ChangeValue = string | boolean | null;

/** An entry before it is tied to a run (the writer adds the run and the instant). */
export interface ChangeDraft {
  propertyCode: string;
  source: ChangeSource;
  type: ChangeType;
  relevant: boolean;
  /** The tracked field: `available`, `modality`, `currentMinimumPrice` ... One entry per field per run. */
  field: string;
  oldValue: ChangeValue;
  newValue: ChangeValue;
}

const RELEVANT: ReadonlySet<ChangeType> = new Set<ChangeType>([
  'NEW',
  'RETURNED',
  'BECAME_UNAVAILABLE',
  'PRICE_DROPPED',
  'STARTED_FINANCING',
  'STARTED_FGTS',
  'MODALITY_OR_ROUND_CHANGED',
  'NEW_DATE',
]);

/**
 * BR-004-26: the types the PRD calls relevant (what the Radar and the digest read): started financing
 * or FGTS, price dropped, modality or round changed, new date, became unavailable; new and
 * returned are recorded with them. A price rise, a stopped payment method and any other field are
 * history only.
 */
export function isRelevantChange(type: ChangeType): boolean {
  return RELEVANT.has(type);
}
