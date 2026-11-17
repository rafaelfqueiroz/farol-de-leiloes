// SPEC-002 BR-002-02 / BR-002-23 / BR-002-25 / TS-02: AccountScopedRepository against a real
// MongoDB, through a test-only account collection. A support grant's view
// (AccessContextFactory.supportGrantView) opens client data only, never an account's own data: every
// read — base methods and a subclass query built on `ownedBy` — throws the module's not-found, and
// every write is FORBIDDEN, all before the database is touched; the records stay as they were.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose, { type Connection, type Model, Schema, type Types } from 'mongoose';
import { AccountScopedRepository } from '../../src/access/account-scoped.repository.js';
import { DomainError } from '../../src/common/errors/domain-error.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { accessContextFactory, fakeAccessSources } from '../fakes/fake-access-sources.js';
import { useTestDatabase } from '../support/test-database.js';

interface NoteRecord {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  text: string;
}

class NotesRepository extends AccountScopedRepository<NoteRecord> {
  constructor(model: Model<NoteRecord>) {
    // A module's own not-found, to prove the refusal answers with it (AR-14).
    super(model, 'SAVED_FILTER_NOT_FOUND');
  }

  /** A subclass query, built on `ownedBy` like RemindersRepository's populated reads. */
  texts(ctx: Parameters<NotesRepository['find']>[0]): Promise<NoteRecord[]> {
    return this.model.find(this.ownedBy(ctx)).lean<NoteRecord[]>().exec();
  }
}

const ACCOUNT = '64b7f0000000000000000c01';

describe('AccountScopedRepository (integration, SPEC-002 BR-002-02, BR-002-23, BR-002-25)', () => {
  const db = useTestDatabase();
  const factory = accessContextFactory(fakeAccessSources());
  let connection: Connection;
  let notes: NotesRepository;
  let model: Model<NoteRecord>;

  beforeAll(async () => {
    applyMongooseDefaults(); // SC-10: the production query settings
    connection = await mongoose.createConnection(db.uri).asPromise();
    model = connection.model<NoteRecord>(
      'AccountNoteProbe',
      new Schema({
        userId: { type: Schema.Types.ObjectId, required: true },
        text: { type: String, required: true },
      }),
    );
    notes = new NotesRepository(model);
  });

  afterAll(async () => {
    await connection.close();
  });

  it('BR-002-02 / BR-002-23: a support grant’s view reads none of the account’s own data, and writes none', async () => {
    const own = await factory.forAccount({ userId: ACCOUNT, isAdmin: false });
    const note = await notes.create(own, { text: 'kept' });
    const id = note._id.toString();
    const view = factory.supportGrantView(own);
    const notFound = new DomainError('SAVED_FILTER_NOT_FOUND');
    const forbidden = new DomainError('FORBIDDEN');

    // Reads: the module's not-found, a list and a count included (never an empty answer).
    await expect(notes.findById(view, id)).rejects.toEqual(notFound);
    await expect(notes.findById(view, 'not-an-id')).rejects.toEqual(notFound);
    await expect(notes.findOne(view, {})).rejects.toEqual(notFound);
    await expect(notes.find(view)).rejects.toEqual(notFound);
    await expect(notes.count(view)).rejects.toEqual(notFound);
    expect(() => notes.texts(view)).toThrow(notFound);
    // Writes: read-only (BR-002-25).
    await expect(notes.create(view, { text: 'new' })).rejects.toEqual(forbidden);
    await expect(notes.updateById(view, id, { text: 'changed' })).rejects.toEqual(forbidden);
    await expect(notes.deleteById(view, id)).rejects.toEqual(forbidden);
    await expect(notes.deleteMany(view, {})).rejects.toEqual(forbidden);

    const stored = await model.find({}).lean().exec();
    expect(stored.map((record) => record.text)).toEqual(['kept']);
    expect((await notes.texts(own)).map((record) => record.text)).toEqual(['kept']);
  });

  it('the account’s own context still writes', async () => {
    const own = await factory.forAccount({ userId: ACCOUNT, isAdmin: false });
    const [first] = await notes.find(own);

    const updated = await notes.updateById(own, first?._id.toString() ?? '', { text: 'changed' });

    expect(updated.text).toBe('changed');
    expect(await notes.deleteMany(own, {})).toBe(1);
  });
});
