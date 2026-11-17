import { describe, expect, it } from 'vitest';
import mongoose, { Schema } from 'mongoose';
import { isolationMarkOf, isOwnedSchema, markIsolation } from './isolation-mark.js';

describe('markIsolation (SPEC-002 AR-16, TS-14)', () => {
  it('keeps the mark on the schema, frozen, and through a clone', () => {
    const schema = new Schema({ code: String });
    markIsolation(schema, { kind: 'public', reason: 'the Caixa catalogue' });

    expect(isolationMarkOf(schema)).toEqual({ kind: 'public', reason: 'the Caixa catalogue' });
    expect(Object.isFrozen(isolationMarkOf(schema))).toBe(true);
    expect(isolationMarkOf(schema.clone())).toEqual(isolationMarkOf(schema));
  });

  it('keeps the mark on the model a connection registers', () => {
    const schema = new Schema({ userId: Schema.Types.ObjectId });
    markIsolation(schema, { kind: 'account', reason: 'BR-002-02' });
    const model = mongoose.createConnection().model('MarkedProbe', schema);

    expect(isolationMarkOf(model.schema)).toMatchObject({ kind: 'account' });
  });

  it('AR-16: an owned schema (ownerId) takes no mark', () => {
    const schema = new Schema({ ownerType: String, ownerId: Schema.Types.ObjectId });

    expect(isOwnedSchema(schema)).toBe(true);
    expect(() => markIsolation(schema, { kind: 'public', reason: 'not really' })).toThrow(
      /owned \(AR-11\)/,
    );
    expect(isolationMarkOf(schema)).toBeUndefined();
  });

  it('refuses an account mark on a schema with no userId (BR-002-02)', () => {
    expect(() =>
      markIsolation(new Schema({ name: String }), { kind: 'account', reason: 'x' }),
    ).toThrow(/userId/);
  });

  it('refuses an unknown kind and an empty reason', () => {
    const schema = new Schema({ name: String });

    expect(() =>
      markIsolation(schema, { kind: 'shared' as unknown as 'public', reason: 'x' }),
    ).toThrow(/Unknown isolation kind/);
    expect(() => markIsolation(schema, { kind: 'internal', reason: '  ' })).toThrow(/reason/);
  });

  it('an unmarked schema without ownerId has no class at all', () => {
    const schema = new Schema({ name: String });

    expect(isOwnedSchema(schema)).toBe(false);
    expect(isolationMarkOf(schema)).toBeUndefined();
  });
});
