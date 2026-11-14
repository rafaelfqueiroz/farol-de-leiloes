// #81 / AR-29: the rename of the saved-filter price bounds, against a recording fake of the
// collection (TS-04: expectations are the exact filters and counts). The run against MongoDB is
// test/integration/migrations.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import {
  PRICE_BOUND_RENAMES,
  PriceBoundConflictError,
  renameSavedFilterPriceBounds,
  savedFilterPriceBounds,
} from './0002-saved-filter-price-bounds.migration.js';

function fakeDb(conflicts: number, modified: number[]) {
  const countDocuments = vi.fn().mockResolvedValue(conflicts);
  const updateMany = vi.fn();
  for (const count of modified) updateMany.mockResolvedValueOnce({ modifiedCount: count });
  const collection = vi.fn().mockReturnValue({ countDocuments, updateMany });
  return { db: { collection } as unknown as mongo.Db, collection, countDocuments, updateMany };
}

describe('renameSavedFilterPriceBounds', () => {
  it('renames each bound only where the old name exists and the new one does not', async () => {
    const { db, collection, updateMany } = fakeDb(0, [3, 1]);

    await expect(renameSavedFilterPriceBounds(db)).resolves.toEqual({
      'filters.minPrice': 3,
      'filters.maxPrice': 1,
    });

    expect(collection).toHaveBeenCalledWith('savedfilters');
    expect(updateMany).toHaveBeenNthCalledWith(
      1,
      { 'filters.minMargin': { $exists: true }, 'filters.minPrice': { $exists: false } },
      { $rename: { 'filters.minMargin': 'filters.minPrice' } },
    );
    expect(updateMany).toHaveBeenNthCalledWith(
      2,
      { 'filters.maxMargin': { $exists: true }, 'filters.maxPrice': { $exists: false } },
      { $rename: { 'filters.maxMargin': 'filters.maxPrice' } },
    );
  });

  it('looks for documents holding both names of a bound before writing', async () => {
    const { db, countDocuments } = fakeDb(0, [0, 0]);

    await renameSavedFilterPriceBounds(db);

    expect(countDocuments).toHaveBeenCalledWith({
      $or: [
        { 'filters.minMargin': { $exists: true }, 'filters.minPrice': { $exists: true } },
        { 'filters.maxMargin': { $exists: true }, 'filters.maxPrice': { $exists: true } },
      ],
    });
  });

  it('stops with the count of conflicts, without writing anything', async () => {
    const { db, updateMany } = fakeDb(2, []);

    const failure = await renameSavedFilterPriceBounds(db).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PriceBoundConflictError);
    expect((failure as PriceBoundConflictError).conflicts).toBe(2);
    expect((failure as Error).message).toContain('2 saved filter(s)');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('reports 0 when nothing holds an old name (a re-run)', async () => {
    const { db } = fakeDb(0, [0, 0]);

    await expect(renameSavedFilterPriceBounds(db)).resolves.toEqual({
      'filters.minPrice': 0,
      'filters.maxPrice': 0,
    });
  });
});

describe('savedFilterPriceBounds', () => {
  it('has the id its file name gives and renames the two bounds', async () => {
    expect(savedFilterPriceBounds.id).toBe('0002-saved-filter-price-bounds');
    expect(PRICE_BOUND_RENAMES.map(({ to }) => to)).toEqual([
      'filters.minPrice',
      'filters.maxPrice',
    ]);

    const { db, updateMany } = fakeDb(0, [0, 0]);
    await savedFilterPriceBounds.up(db);
    expect(updateMany).toHaveBeenCalledTimes(2);
  });
});
