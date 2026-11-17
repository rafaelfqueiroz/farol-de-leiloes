// SPEC-002 BR-002-02 / BR-002-25 / TS-02: AccountScopedRepository against a real MongoDB, through a
// test-only account collection. A read-only context (what a part 3 support grant is built from,
// AccessContextFactory.readOnlyView) reads the account's own data and writes none of it: every
// write is FORBIDDEN before it reaches the database, and the records are left as they were.
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
    super(model);
  }
}

const ACCOUNT = '64b7f0000000000000000c01';

describe('AccountScopedRepository (integration, SPEC-002 BR-002-25)', () => {
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

  it('BR-002-25: a read-only context reads the account’s data and every write is FORBIDDEN', async () => {
    const own = await factory.forAccount({ userId: ACCOUNT, isAdmin: false });
    const note = await notes.create(own, { text: 'kept' });
    const id = note._id.toString();
    const view = factory.readOnlyView(own);
    const forbidden = new DomainError('FORBIDDEN');

    expect((await notes.findById(view, id))?.text).toBe('kept');
    expect(await notes.count(view)).toBe(1);
    await expect(notes.create(view, { text: 'new' })).rejects.toEqual(forbidden);
    await expect(notes.updateById(view, id, { text: 'changed' })).rejects.toEqual(forbidden);
    await expect(notes.deleteById(view, id)).rejects.toEqual(forbidden);
    await expect(notes.deleteMany(view, {})).rejects.toEqual(forbidden);

    const stored = await model.find({}).lean().exec();
    expect(stored.map((record) => record.text)).toEqual(['kept']);
  });

  it('the account’s own context still writes', async () => {
    const own = await factory.forAccount({ userId: ACCOUNT, isAdmin: false });
    const [first] = await notes.find(own);

    const updated = await notes.updateById(own, first?._id.toString() ?? '', { text: 'changed' });

    expect(updated.text).toBe('changed');
    expect(await notes.deleteMany(own, {})).toBe(1);
  });
});
