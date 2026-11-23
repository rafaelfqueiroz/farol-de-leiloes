// SPEC-010 (#10) BR-010-06, SC-26, AR-29: 0011-erase-legacy-profile-fields against a real MongoDB, on
// a database no Mongoose model has touched. Users are seeded with each legacy field alone, with all
// four, with none and already erased; the migration runs twice and the second run must change
// nothing. Every other field of every user, and every other collection, must come out identical.
// Values are obviously fake (TS-27).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection, type mongo, Types } from 'mongoose';
import {
  eraseLegacyProfileFields,
  eraseLegacyProfileFieldsMigration,
} from '../../src/migrations/0011-erase-legacy-profile-fields.migration.js';
import { useTestDatabase } from '../support/test-database.js';

const ERASED = ['cpf', 'dateOfBirth', 'sex', 'address'] as const;
const AT = new Date('2026-01-02T03:04:05.000Z');

/** Fields every seeded user carries, the legacy billing ones included: none may change. */
const common = (email: string) => ({
  email,
  name: 'Fulana de Teste',
  phone: '+5500000000000',
  providers: ['local'],
  emailVerified: true,
  role: 'premium',
  isAdmin: false,
  stripeCustomerId: 'cus_fake',
  stripeSubscriptionId: 'sub_fake',
  subscriptionStatus: 'active',
  credentialVersion: 2,
  createdAt: AT,
  updatedAt: AT,
});

const ADDRESS = { street: 'Rua Fake', city: 'Cidade Fake', state: 'XX', zipCode: '00000000' };

describe('0011-erase-legacy-profile-fields (integration)', () => {
  const testDb = useTestDatabase();
  let connection: Connection;
  let db: mongo.Db;

  const users = () => db.collection('users');
  const byEmail = (email: string) => users().findOne({ email });
  const all = () => users().find({}).sort({ email: 1 }).toArray();
  const without = (doc: Record<string, unknown> | null, names: readonly string[]) => {
    const copy = { ...doc };
    for (const name of names) delete copy[name];
    return copy;
  };

  const SEEDED_OTHERS = [
    { _id: new Types.ObjectId(), cpf: 'not-a-user-document', note: 'other collection' },
  ];

  beforeAll(async () => {
    connection = await createConnection(testDb.uri).asPromise();
    if (!connection.db) throw new Error('connection has no db');
    db = connection.db;
    await users().insertMany([
      { ...common('only-cpf@example.test'), cpf: '00000000000' },
      { ...common('only-birth@example.test'), dateOfBirth: new Date('1990-01-01T00:00:00.000Z') },
      { ...common('only-sex@example.test'), sex: 'female' },
      { ...common('only-address@example.test'), address: ADDRESS },
      {
        ...common('all-four@example.test'),
        cpf: '11111111111',
        dateOfBirth: new Date('1980-02-02T00:00:00.000Z'),
        sex: 'other',
        address: ADDRESS,
      },
      // A value that is present but empty or null still counts as stored (`$exists`), and goes.
      { ...common('null-values@example.test'), cpf: null, address: null },
      { ...common('none@example.test') },
      // Already erased by an earlier run: another field set, none of the four.
      { ...common('already-erased@example.test'), whatsappPromptAnsweredAt: AT },
    ]);
    await db.collection('savedfilters').insertMany(SEEDED_OTHERS);
  });

  afterAll(async () => {
    await connection.close();
  });

  it('removes each of the four fields, alone or together, and nothing else', async () => {
    const before = await all();

    const counts = await eraseLegacyProfileFields(db);

    expect(counts).toEqual({ matched: 6, modified: 6 }); // all but none@ and already-erased@
    const after = await all();
    expect(after).toHaveLength(before.length);
    for (const doc of after) {
      for (const name of ERASED) expect(doc).not.toHaveProperty(name);
    }
    // every other field of every user is identical, value and type
    expect(after).toEqual(before.map((doc) => without(doc, ERASED)));
  });

  it('keeps the legacy billing fields: they are SPEC-012’s contract step', async () => {
    expect(await byEmail('all-four@example.test')).toMatchObject({
      role: 'premium',
      stripeCustomerId: 'cus_fake',
      stripeSubscriptionId: 'sub_fake',
      subscriptionStatus: 'active',
      phone: '+5500000000000',
      createdAt: AT,
    });
  });

  it('leaves users without the fields, and other collections, byte-identical', async () => {
    expect(await byEmail('none@example.test')).toMatchObject(common('none@example.test'));
    expect(await byEmail('already-erased@example.test')).toMatchObject({
      ...common('already-erased@example.test'),
      whatsappPromptAnsweredAt: AT,
    });
    // a `cpf` key in a document of another collection is not a user field: not touched
    expect(await db.collection('savedfilters').find({}).toArray()).toEqual(SEEDED_OTHERS);
  });

  it('a second run matches and changes nothing', async () => {
    const before = await all();

    await expect(eraseLegacyProfileFields(db)).resolves.toEqual({ matched: 0, modified: 0 });
    await expect(eraseLegacyProfileFieldsMigration.up(db)).resolves.toBeUndefined();

    expect(await all()).toEqual(before);
  });

  it('erases a user that appears after the first run, and only that one', async () => {
    await users().insertOne({ ...common('late@example.test'), cpf: '22222222222', sex: 'male' });
    const before = await all();

    await expect(eraseLegacyProfileFields(db)).resolves.toEqual({ matched: 1, modified: 1 });

    const after = await all();
    expect(after).toEqual(before.map((doc) => without(doc, ERASED)));
    expect(await byEmail('late@example.test')).not.toHaveProperty('cpf');
  });
});
