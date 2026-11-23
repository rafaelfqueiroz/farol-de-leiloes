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
import { fromDecimal128OrNull, toDecimal128OrNull } from '../common/money/decimal128.js';
import { isActive } from './domain/active.js';
import { currentMinimumPrice, discountPercent, type Round } from './domain/rounds.js';
import type { StoredPhase, StoredRound } from './schemas/auction.schema.js';
import type { Auction, AuctionRecord, Phase } from './interfaces/auction.interface.js';

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

/** A stored round in code: its price as a Decimal (AR-17); an absent date is open-ended. */
export function fromStoredRound(stored: StoredRound): Round {
  return {
    label: stored.label,
    minimumPrice: fromDecimal128OrNull(stored.minimumPrice),
    date: stored.date ?? null,
  };
}

/** AR-17: a round as written, its price as Decimal128. */
export function toStoredRound(round: Round): StoredRound {
  return {
    label: round.label,
    minimumPrice: toDecimal128OrNull(round.minimumPrice),
    date: round.date,
  };
}

/**
 * The `Auction` of a stored record, lean or hydrated. `now` (AR-24) is the instant the read
 * happens: whether the property is active, its current price and its discount are computed
 * against it, never stored (BR-004-13, BR-004-14, BR-004-16, DL-004-06, DL-004-07).
 */
export function toAuction(doc: AuctionRecord, now: Date): Auction {
  const phases = (doc.phases ?? []).map(fromStoredPhase);

  // Compute URLs from file objects (prefer publicUrl, fallback to originalUrl)
  const imageUrl = doc.image?.publicUrl ?? doc.image?.originalUrl ?? null;
  const matriculaUrl = doc.matricula?.publicUrl ?? doc.matricula?.originalUrl ?? null;

  const rounds = (doc.rounds ?? []).map(fromStoredRound);
  const available = doc.available ?? true;
  const appraisalPrice = fromDecimal128OrNull(doc.appraisalPrice);
  const currentPhase = doc.currentPhase
    ? fromStoredPhase(doc.currentPhase)
    : (phases[phases.length - 1] ?? null);
  const price = currentMinimumPrice(rounds, currentPhase?.minimumPrice ?? null, now);

  return {
    code: doc.code,
    title: doc.title ?? null,
    address: doc.address ?? null,
    appraisalPrice,
    phases,
    currentPhase,
    propertyType: doc.propertyType ?? null,
    rounds,
    occupancy: doc.occupancy ?? null,
    listSeenAt: doc.listSeenAt ?? null,
    detailsCollectedAt: doc.detailsCollectedAt ?? null,
    detailsUrl: doc.detailsUrl ?? null,
    imageUrl,
    matriculaUrl,
    // Disabled: the edital belongs to an auction phase, not to the auction itself.
    editalUrl: null,
    description: doc.description ?? null,
    fulfilled: doc.fulfilled ?? false,
    available,
    active: isActive({ available, rounds }, now),
    currentMinimumPrice: price,
    discountPercent: discountPercent(appraisalPrice, price),
    updatedAt: doc.updatedAt,
  };
}
