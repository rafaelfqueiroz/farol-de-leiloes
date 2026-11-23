// SPEC-010 (#10) BR-010-06, AR-29: 0011-erase-legacy-profile-fields against a recording fake of the
// collection (TS-04: the expectations are the exact filter and update). The run against MongoDB is
// test/integration/erase-legacy-profile-fields-migration.spec.ts.
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { mongo } from 'mongoose';
import {
  ERASED_USER_FIELDS,
  eraseLegacyProfileFields,
  eraseLegacyProfileFieldsMigration,
} from './0011-erase-legacy-profile-fields.migration.js';

function fakeDb(matchedCount: number, modifiedCount: number) {
  const updateMany = vi.fn().mockResolvedValue({ matchedCount, modifiedCount });
  const collection = vi.fn().mockReturnValue({ updateMany });
  return { db: { collection } as unknown as mongo.Db, collection, updateMany };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('eraseLegacyProfileFields', () => {
  it('unsets exactly cpf, dateOfBirth, sex and address, on the documents that hold one', async () => {
    const { db, collection, updateMany } = fakeDb(5, 5);

    await expect(eraseLegacyProfileFields(db)).resolves.toEqual({ matched: 5, modified: 5 });

    expect(collection).toHaveBeenCalledTimes(1);
    expect(collection).toHaveBeenCalledWith('users');
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      {
        $or: [
          { cpf: { $exists: true } },
          { dateOfBirth: { $exists: true } },
          { sex: { $exists: true } },
          { address: { $exists: true } },
        ],
      },
      { $unset: { cpf: '', dateOfBirth: '', sex: '', address: '' } },
    );
  });

  it('names the four fields and no other (the legacy billing fields are SPEC-012’s)', () => {
    expect([...ERASED_USER_FIELDS]).toEqual(['cpf', 'dateOfBirth', 'sex', 'address']);
  });

  it('reports nothing matched and nothing modified once the fields are gone', async () => {
    const { db } = fakeDb(0, 0);

    await expect(eraseLegacyProfileFields(db)).resolves.toEqual({ matched: 0, modified: 0 });
  });
});

describe('0011-erase-legacy-profile-fields', () => {
  it('has the id its file name gives and runs the erasure', async () => {
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { db, updateMany } = fakeDb(0, 0);

    expect(eraseLegacyProfileFieldsMigration.id).toBe('0011-erase-legacy-profile-fields');
    await expect(eraseLegacyProfileFieldsMigration.up(db)).resolves.toBeUndefined();

    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('logs counts only: no value, no id (SC-15)', async () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const { db } = fakeDb(3, 2);

    await eraseLegacyProfileFieldsMigration.up(db);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('0011-erase-legacy-profile-fields {"matched":3,"modified":2}');
  });

  it('fails the run when the driver refuses the update (the deploy stops, DV-34)', async () => {
    const { db, updateMany } = fakeDb(0, 0);
    updateMany.mockRejectedValueOnce(new Error('connection lost'));

    await expect(eraseLegacyProfileFieldsMigration.up(db)).rejects.toThrow('connection lost');
  });
});
