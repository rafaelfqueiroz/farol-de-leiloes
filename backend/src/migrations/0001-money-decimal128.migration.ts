// #34, part 2 of 3: the backfill between expand and contract (AR-28). Money stored before #34 as a
// JS number becomes Decimal128 (AR-17), so the code deployed with this migration reads Decimal128
// only. Run before that code starts (DV-34).
//
//   auctions     appraisalPrice, phases[].minimumPrice, currentPhase.minimumPrice   reais → reais
//   coupons      discountValue                          integer centavos → reais (converted in place)
//   savedfilters filters.minMargin, filters.maxMargin                        reais → reais
//
// Idempotent (AR-29): every change selects only fields still holding a BSON number, and each write
// is conditional on the field still holding the value that was read, so a re-run, a run that died
// halfway or a document the running expand-step code rewrote meanwhile is never converted twice.
// That matters most for coupons: dividing by 100 twice would turn R$ 10,00 into R$ 0,10.
//
// The collections are named here, not reached through the schemas: a migration keeps doing what
// it did when it was written, whatever the models become (migration.ts).
import { Logger } from '@nestjs/common';
import { type mongo, Types } from 'mongoose';
import { toDecimal128 } from '../common/money/decimal128.js';
import { Decimal } from '../common/money/money.js';
import type { Migration } from './migration.js';

/**
 * The BSON number types a legacy amount may have. Never the `'number'` alias: it also matches
 * `decimal`, which is the converted shape and must be left alone.
 */
export const LEGACY_NUMBER_TYPES = ['double', 'int', 'long'];

const BATCH_SIZE = 500;

/**
 * A legacy amount of reais as Decimal128, through the number's shortest round-trip text — the
 * same reading the expand step's reader gave it (`fromStoredMoney`, removed by this PR), so no
 * price changes by migrating:
 *
 *   91589.89 (a double that is really 91589.889999999999417923390865325927734375)
 *     → String() "91589.89" → Decimal128 91589.89
 *   130000 → Decimal128 130000
 *
 * A non-finite number was never written (the importer stored null for an unparseable price), so
 * one is a fault that stops the migration rather than a price to guess.
 */
export function reaisFromLegacyNumber(value: number): Types.Decimal128 {
  if (!Number.isFinite(value)) {
    throw new TypeError('A legacy amount is not a finite number');
  }
  return toDecimal128(new Decimal(String(value)));
}

/**
 * A legacy coupon discount, integer centavos, as Decimal128 reais at the two places centavos
 * have: 1050 / 100 = 10.50 → "10.50"; 1000 → "10.00". Integer division by 100 is exact.
 * Anything but an integer was never written as centavos, so it stops the migration.
 */
export function reaisFromLegacyCentavos(value: number): Types.Decimal128 {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError('A legacy coupon discount is not an integer number of centavos');
  }
  return Types.Decimal128.fromString(new Decimal(value).div(100).toFixed(2));
}

/** One field to rewrite: its dotted path, the legacy value read, and its Decimal128. */
export interface FieldChange {
  readonly path: string;
  readonly from: number;
  readonly to: Types.Decimal128;
}

type Convert = (value: number) => Types.Decimal128;

function change(path: string, value: unknown, convert: Convert): FieldChange[] {
  return typeof value === 'number' ? [{ path, from: value, to: convert(value) }] : [];
}

function field(container: unknown, name: string): unknown {
  return typeof container === 'object' && container !== null
    ? (container as Record<string, unknown>)[name]
    : undefined;
}

/** The legacy prices of an auction. A null or absent price, or a Decimal128 one, is no change. */
export function auctionChanges(doc: mongo.Document): FieldChange[] {
  const phases: unknown[] = Array.isArray(doc.phases) ? doc.phases : [];
  return [
    ...change('appraisalPrice', doc.appraisalPrice, reaisFromLegacyNumber),
    ...phases.flatMap((phase, index) =>
      change(`phases.${index}.minimumPrice`, field(phase, 'minimumPrice'), reaisFromLegacyNumber),
    ),
    ...change(
      'currentPhase.minimumPrice',
      field(doc.currentPhase, 'minimumPrice'),
      reaisFromLegacyNumber,
    ),
  ];
}

/** A coupon's legacy discount, in centavos. */
export function couponChanges(doc: mongo.Document): FieldChange[] {
  return change('discountValue', doc.discountValue, reaisFromLegacyCentavos);
}

/** A saved filter's legacy price bounds. */
export function savedFilterChanges(doc: mongo.Document): FieldChange[] {
  return [
    ...change('filters.minMargin', field(doc.filters, 'minMargin'), reaisFromLegacyNumber),
    ...change('filters.maxMargin', field(doc.filters, 'maxMargin'), reaisFromLegacyNumber),
  ];
}

/**
 * The write for one document: each changed path is set to its Decimal128, on condition that it
 * still holds the number that was read (compare-and-set). `$type` is part of the condition
 * because MongoDB compares numbers across BSON types by value: `{ $eq: 1000 }` alone would also
 * match a Decimal128 1000.
 */
export function conditionalUpdate(
  id: unknown,
  changes: readonly FieldChange[],
): mongo.AnyBulkWriteOperation {
  const filter: mongo.Document = { _id: id };
  const set: mongo.Document = {};
  for (const { path, from, to } of changes) {
    filter[path] = { $eq: from, $type: LEGACY_NUMBER_TYPES };
    set[path] = to;
  }
  return { updateOne: { filter, update: { $set: set } } };
}

interface Conversion {
  readonly collection: string;
  /** The paths that may hold a legacy number; a document matching none of them is skipped. */
  readonly paths: readonly string[];
  readonly changes: (doc: mongo.Document) => FieldChange[];
}

const CONVERSIONS: readonly Conversion[] = [
  {
    collection: 'auctions',
    paths: ['appraisalPrice', 'phases.minimumPrice', 'currentPhase.minimumPrice'],
    changes: auctionChanges,
  },
  { collection: 'coupons', paths: ['discountValue'], changes: couponChanges },
  {
    collection: 'savedfilters',
    paths: ['filters.minMargin', 'filters.maxMargin'],
    changes: savedFilterChanges,
  },
];

/** Documents rewritten per collection, e.g. `{ auctions: 1200, coupons: 3, savedfilters: 40 }`. */
export type MoneyMigrationCounts = Record<string, number>;

async function convert(db: mongo.Db, conversion: Conversion): Promise<number> {
  const collection = db.collection(conversion.collection);
  const candidates = collection.find(
    { $or: conversion.paths.map((path) => ({ [path]: { $type: LEGACY_NUMBER_TYPES } })) },
    // Only the money paths are read; nothing else of a document (a saved filter's owner, say)
    // is loaded or logged (SC-15).
    { projection: Object.fromEntries(conversion.paths.map((path) => [path.split('.')[0], 1])) },
  );

  let modified = 0;
  let batch: mongo.AnyBulkWriteOperation[] = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const result = await collection.bulkWrite(batch, { ordered: false });
    modified += result.modifiedCount;
    batch = [];
  };

  for await (const doc of candidates) {
    const changes = conversion.changes(doc);
    if (changes.length === 0) continue;
    batch.push(conditionalUpdate(doc._id, changes));
    if (batch.length >= BATCH_SIZE) await flush();
  }
  await flush();
  return modified;
}

/** Converts every legacy amount; answers how many documents each collection had rewritten. */
export async function convertMoneyToDecimal128(db: mongo.Db): Promise<MoneyMigrationCounts> {
  const counts: MoneyMigrationCounts = {};
  for (const conversion of CONVERSIONS) {
    counts[conversion.collection] = await convert(db, conversion);
  }
  return counts;
}

export const moneyDecimal128: Migration = {
  id: '0001-money-decimal128',
  description: 'money as Decimal128 reais; coupon discounts from centavos to reais (#34)',
  async up(db) {
    const counts = await convertMoneyToDecimal128(db);
    // Counts only: no document content reaches the log (SC-15).
    new Logger('Migrations').log(`0001-money-decimal128 rewrote ${JSON.stringify(counts)}`);
  },
};
