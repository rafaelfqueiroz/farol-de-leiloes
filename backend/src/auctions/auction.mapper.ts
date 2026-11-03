// The crossing between stored auctions and the `Auction` code works with. Money is the reason it
// exists: `phases` and `currentPhase` are Mixed paths, so Mongoose casts nothing in them, and
// these functions are where a price becomes Decimal128 on the way in and Decimal on the way out
// (AR-17). Every writer of a phase goes through toStoredPhase; every reader through toAuction.
//
// Why not a Phase sub-schema (`{ _id: false }`) so Mongoose casts minimumPrice itself? Reads are
// `.lean()`, which bypasses casting, so the explicit reader is needed regardless; and turning the
// Mixed paths into sub-documents would change the casting and hydration of every phase field in
// the same deploy as the money change, which the expand step (AR-28) is meant to avoid. PR 2 of
// #34 can introduce the sub-schema once every stored price is Decimal128.
import { toDecimal128OrNull } from '../common/money/decimal128';
import { fromStoredMoney } from '../common/money/stored-money';
import type { StoredPhase } from './schemas/auction.schema';
import type { Auction, AuctionRecord, Phase } from './interfaces/auction.interface';

/** A stored phase in code: its price as a Decimal, whichever shape it was stored in. */
export function fromStoredPhase(stored: StoredPhase): Phase {
  return {
    modality: stored.modality,
    // EXPAND (AR-28): remove in contract step, #34 PR 2 — tolerates a legacy number.
    minimumPrice: fromStoredMoney(stored.minimumPrice),
    phaseDates: stored.phaseDates,
    paymentMethods: stored.paymentMethods,
    expenseRules: stored.expenseRules,
  };
}

/** AR-17: a phase as written — its price as Decimal128, never a number. */
export function toStoredPhase(phase: Phase): StoredPhase {
  const stored: StoredPhase = {
    modality: phase.modality,
    minimumPrice: toDecimal128OrNull(phase.minimumPrice),
  };
  // The driver would store an undefined field as null; leave absent what was absent.
  if (phase.phaseDates !== undefined) stored.phaseDates = phase.phaseDates;
  if (phase.paymentMethods !== undefined) stored.paymentMethods = phase.paymentMethods;
  if (phase.expenseRules !== undefined) stored.expenseRules = phase.expenseRules;
  return stored;
}

/**
 * EXPAND (AR-28): remove in contract step, #34 PR 2 (once every stored phase is Decimal128, a
 * stored phase can be written back as it was read). A phase read from the database and written
 * back — the importer appending a phase, the scraper filling details in — leaves in the new shape,
 * so a legacy number price becomes Decimal128 on its next write.
 */
export function restorePhase(stored: StoredPhase): StoredPhase {
  return toStoredPhase(fromStoredPhase(stored));
}

/** The `Auction` of a stored record, lean or hydrated. */
export function toAuction(doc: AuctionRecord): Auction {
  const phases = (doc.phases ?? []).map(fromStoredPhase);

  // Compute URLs from file objects (prefer publicUrl, fallback to originalUrl)
  const imageUrl = doc.image?.publicUrl ?? doc.image?.originalUrl ?? null;
  const matriculaUrl = doc.matricula?.publicUrl ?? doc.matricula?.originalUrl ?? null;

  return {
    code: doc.code,
    title: doc.title ?? null,
    address: doc.address ?? null,
    // EXPAND (AR-28): remove in contract step, #34 PR 2 — tolerates a legacy number.
    appraisalPrice: fromStoredMoney(doc.appraisalPrice),
    phases,
    currentPhase: doc.currentPhase
      ? fromStoredPhase(doc.currentPhase)
      : (phases[phases.length - 1] ?? null),
    detailsUrl: doc.detailsUrl ?? null,
    imageUrl,
    matriculaUrl,
    // Disabled: the edital belongs to an auction phase, not to the auction itself.
    editalUrl: null,
    description: doc.description ?? null,
    fulfilled: doc.fulfilled ?? false,
    available: doc.available ?? true,
    updatedAt: doc.updatedAt,
  };
}
