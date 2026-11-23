// SPEC-004 BR-004-05..09, BR-004-25, BR-004-26: what one row of the daily list changes in the
// property it names. Pure (AR-05): the stored state and the row go in, the change entries and the
// field updates come out; the repository turns them into writes.
//
// Only three fields are TRACKED (BR-004-25): availability, modality and the current minimum price.
// Address, description and appraisal changes are applied and make the property "changed", but they
// get no entry. Everything is compared after the same reading (money by value, text as is), so
// applying a list twice finds nothing the second time (BR-004-07).
import { Decimal } from '../../common/money/money.js';
import { type ChangeDraft, type ChangeType, isRelevantChange } from './change-types.js';
import type { PhaseModality } from './modality.js';

export interface ListAddress {
  street?: string | undefined;
  neighborhood?: string | undefined;
  city?: string | undefined;
  state?: string | undefined;
}

/** The fields the list carries (BR-004-06), as the importer read them. */
export interface ListFields {
  /** The list's description (stored in `title`). */
  title: string | null;
  address: ListAddress;
  appraisalPrice: Decimal | null;
  detailsUrl: string | null;
  /** BR-004-11 fallback from the description; null = unknown. */
  propertyType: string | null;
}

export interface ListRow extends ListFields {
  code: string;
  /** The list price: the current minimum price when the list was made. */
  minimumPrice: Decimal | null;
  /** Null when the modality text is not one the product knows. */
  modality: PhaseModality | null;
}

/** What the diff reads of a stored property. */
export interface StoredListState extends ListFields {
  available: boolean;
  /** The current phase's modality; null when it has none. */
  modality: PhaseModality | null;
  /** The current phase's price: what the list said last time. */
  minimumPrice: Decimal | null;
  /** Number of stored phases (to keep the last one's price in step). */
  phaseCount: number;
  /** The detail page was collected: its property type replaces the list's fallback. */
  detailsCollected: boolean;
  /**
   * Rounds were collected, none is open-ended and every date has passed, yet the list still has
   * the property: the dates are stale and the page must be collected again (BR-004-19).
   */
  staleRounds: boolean;
}

/** The writes of a row that changes a stored property. */
export interface RowUpdate {
  kind: 'update';
  entries: ChangeDraft[];
  /** A list field, availability or modality/price differs: counts as "changed" (BR-004-27). */
  changed: boolean;
  /** Back from unavailable (BR-004-09). */
  returned: boolean;
  /**
   * The collected rounds (and the details date) are dropped so the property is collected again,
   * first (BR-004-19): it came back, its modality changed, or its dates went stale. Until then it
   * has no rounds, which is unknown and active, never "stuck inactive" on old dates.
   */
  refreshDetails: boolean;
  /** The stored property's phase count, to keep its last phase's price in step with the list's. */
  phaseCount: number;
  /** Only the fields that differ. */
  fields: Partial<ListFields>;
  /** The list price, when it differs and the modality did not change. */
  price?: { value: Decimal };
  /** A new phase is appended: the modality changed (or none was stored). */
  modalityChange?: { from: PhaseModality | null; to: PhaseModality; price: Decimal | null };
}

export type RowDiff =
  /** Not stored and cannot be (the modality is unknown): listed, but nothing to write. */
  | { kind: 'skip' }
  | { kind: 'insert'; entries: ChangeDraft[]; modality: PhaseModality; row: ListRow }
  | RowUpdate
  /** Nothing differs; the row is only stamped as seen. */
  | { kind: 'unchanged' };

const money = (value: Decimal | null): string | null => (value === null ? null : value.toFixed(2));

function sameMoney(a: Decimal | null, b: Decimal | null): boolean {
  return a === null || b === null ? a === b : a.eq(b);
}

/**
 * The stored address with the parts the row knows laid over it. An empty part of the row is not a
 * change: unknown never replaces a known value (BR-004-15).
 */
function mergedAddress(stored: ListAddress | null, row: ListAddress): ListAddress {
  return {
    street: row.street || stored?.street,
    neighborhood: row.neighborhood || stored?.neighborhood,
    city: row.city || stored?.city,
    state: row.state || stored?.state,
  };
}

function sameAddress(a: ListAddress | null, b: ListAddress): boolean {
  return (
    (a?.street ?? null) === (b.street ?? null) &&
    (a?.neighborhood ?? null) === (b.neighborhood ?? null) &&
    (a?.city ?? null) === (b.city ?? null) &&
    (a?.state ?? null) === (b.state ?? null)
  );
}

function entry(
  code: string,
  type: ChangeType,
  field: string,
  oldValue: ChangeDraft['oldValue'],
  newValue: ChangeDraft['newValue'],
): ChangeDraft {
  return {
    propertyCode: code,
    source: 'LIST',
    type,
    relevant: isRelevantChange(type),
    field,
    oldValue,
    newValue,
  };
}

/** The entry of a price change; a price that appears or vanishes is an untyped change of the field. */
function priceEntry(code: string, from: Decimal | null, to: Decimal | null): ChangeDraft {
  const type: ChangeType =
    from === null || to === null ? 'OTHER_FIELD' : to.lt(from) ? 'PRICE_DROPPED' : 'PRICE_RAISED';
  return entry(code, type, 'currentMinimumPrice', money(from), money(to));
}

/** BR-004-25: the entry of a property leaving the list; written by the sweep, not by a row. */
export function becameUnavailableEntry(code: string): ChangeDraft {
  return entry(code, 'BECAME_UNAVAILABLE', 'available', true, false);
}

/**
 * The diff of one list row against the stored property (null when it was never stored).
 *
 *   new                      -> insert, entry NEW
 *   stored, was unavailable  -> entry RETURNED (BR-004-09), plus what else differs
 *   modality differs         -> entry MODALITY_OR_ROUND_CHANGED, a phase is appended
 *   price differs            -> PRICE_DROPPED / PRICE_RAISED
 *   address, description, appraisal, link differ -> applied, no entry
 *
 * A row with an unknown modality never changes the stored modality or price, and a value the row
 * leaves empty never replaces a known one (unknown is not a change, BR-004-15). A property that
 * came back, changed modality or has only stale round dates is marked for a fresh collection of
 * its detail page (refreshDetails, BR-004-19).
 */
export function diffListRow(existing: StoredListState | null, row: ListRow): RowDiff {
  if (existing === null) {
    if (row.modality === null) return { kind: 'skip' };
    return {
      kind: 'insert',
      entries: [entry(row.code, 'NEW', 'available', null, true)],
      modality: row.modality,
      row,
    };
  }

  const entries: ChangeDraft[] = [];
  const fields: Partial<ListFields> = {};
  let changed = false;

  const returned = !existing.available;
  if (returned) {
    entries.push(entry(row.code, 'RETURNED', 'available', false, true));
    changed = true;
  }

  // BR-004-15: a value the list does not give (null, empty) never replaces one already known.
  if (row.title !== null && existing.title !== row.title) fields.title = row.title;
  const address = mergedAddress(existing.address, row.address);
  if (!sameAddress(existing.address, address)) fields.address = address;
  if (row.appraisalPrice !== null && !sameMoney(existing.appraisalPrice, row.appraisalPrice)) {
    fields.appraisalPrice = row.appraisalPrice;
  }
  if (row.detailsUrl !== null && existing.detailsUrl !== row.detailsUrl) {
    fields.detailsUrl = row.detailsUrl;
  }
  if (Object.keys(fields).length > 0) changed = true;

  // The type is a fallback, not a list fact: it is applied silently (no entry, not "changed"),
  // and never over the detail page's own value, nor with nothing.
  if (
    !existing.detailsCollected &&
    row.propertyType !== null &&
    existing.propertyType !== row.propertyType
  ) {
    fields.propertyType = row.propertyType;
  }

  const update: RowUpdate = {
    kind: 'update',
    entries,
    changed,
    returned,
    refreshDetails: returned || existing.staleRounds,
    phaseCount: existing.phaseCount,
    fields,
  };

  if (row.modality !== null) {
    if (existing.modality !== row.modality) {
      entries.push(
        entry(row.code, 'MODALITY_OR_ROUND_CHANGED', 'modality', existing.modality, row.modality),
      );
      // A new phase starts with the price the list gives for it, or none: the old modality's
      // price is not this one's.
      update.modalityChange = {
        from: existing.modality,
        to: row.modality,
        price: row.minimumPrice,
      };
      update.changed = true;
      update.refreshDetails = true;
      if (row.minimumPrice !== null && !sameMoney(existing.minimumPrice, row.minimumPrice)) {
        entries.push(priceEntry(row.code, existing.minimumPrice, row.minimumPrice));
      }
    } else if (row.minimumPrice !== null && !sameMoney(existing.minimumPrice, row.minimumPrice)) {
      entries.push(priceEntry(row.code, existing.minimumPrice, row.minimumPrice));
      update.price = { value: row.minimumPrice };
      update.changed = true;
    }
  }

  if (!update.changed && !update.refreshDetails && Object.keys(fields).length === 0) {
    return { kind: 'unchanged' };
  }
  return update;
}
