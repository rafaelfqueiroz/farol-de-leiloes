// The crossing between stored auctions and the `Auction` code works with. Money is the reason it
// exists: `phases` and `currentPhase` are Mixed paths, so Mongoose casts nothing in them, and
// these functions are where a price becomes Decimal128 on the way in and Decimal on the way out
// (AR-17). Every writer of a phase goes through toStoredPhase; every reader through toAuction.
//
// Why not a Phase sub-schema (`{ _id: false }`) so Mongoose casts minimumPrice itself? Reads are
// `.lean()`, which bypasses casting, so this explicit reader is needed regardless, and a
// sub-schema would add nothing to the money path. It would change everything else about a phase:
// strict mode drops on save any field the sub-schema does not declare, `$set` casts every phase
// field, and the enums would start being validated against documents the importer wrote years
// ago. That is a schema change of its own, not part of #34's money contract step (AR-28).
import { fromDecimal128OrNull, toDecimal128OrNull } from '../common/money/decimal128';
import type { StoredPhase } from './schemas/auction.schema';
import type { Auction, AuctionRecord, Phase } from './interfaces/auction.interface';

/** A stored phase in code: its price as a Decimal. */
export function fromStoredPhase(stored: StoredPhase): Phase {
  return {
    modality: stored.modality,
    minimumPrice: fromDecimal128OrNull(stored.minimumPrice),
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
    appraisalPrice: fromDecimal128OrNull(doc.appraisalPrice),
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
