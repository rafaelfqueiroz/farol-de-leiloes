// SPEC-010 BR-010-15 / SC-27: the meta-test's rule can fail (a gate that cannot fail proves nothing).
// Hand-written expectations (TS-04).
import { describe, expect, it } from 'vitest';
import { Schema } from 'mongoose';
import type { RetainedModel } from '../../src/privacy/registry/retained-models.js';
import {
  type ModelUserPaths,
  USER_PATHS,
  modelUserPaths,
  registryProblems,
  userPathsOf,
} from './personal-data-coverage.js';

const retain = (model: string): RetainedModel => ({
  model,
  collection: model.toLowerCase(),
  rule: 'BR-010-22',
  reason: 'a reason',
});
const withPaths = (name: string, ...paths: string[]): ModelUserPaths => ({ name, paths });

describe('userPathsOf', () => {
  it.each(USER_PATHS)('finds %s', (path) => {
    expect(userPathsOf(new Schema({ [path]: String, other: String }))).toEqual([path]);
  });

  it('finds several, and none on a schema without them', () => {
    expect(userPathsOf(new Schema({ createdBy: String, userId: String }))).toEqual([
      'createdBy',
      'userId',
    ]);
    expect(userPathsOf(new Schema({ name: String, ownerId: String }))).toEqual([]);
  });

  it.each(['closedByUserId', 'reviewerUser', 'userIds', 'watcherUserIds', 'users', 'lastUser'])(
    'finds %s by its name (the pattern)',
    (path) => {
      expect(userPathsOf(new Schema({ [path]: [String] }))).toEqual([path]);
    },
  );

  it.each(['superuser', 'username', 'userAgent', 'ownerId', 'userland'])(
    'does not mistake %s for a person',
    (path) => {
      expect(userPathsOf(new Schema({ [path]: String }))).toEqual([]);
    },
  );

  it('finds a nested path, an array of ids and a path inside an array of sub-documents', () => {
    const schema = new Schema({
      owner: { userId: String },
      watcherUserIds: [String],
      members: [new Schema({ role: String, memberUserId: String })],
      meta: new Schema({ invitedBy: String }),
    });

    expect(userPathsOf(schema).sort()).toEqual(
      ['members.memberUserId', 'meta.invitedBy', 'owner.userId', 'watcherUserIds'].sort(),
    );
  });

  it('reads the models of a connection', () => {
    const connection = {
      models: {
        A: { schema: new Schema({ userId: String }) },
        B: { schema: new Schema({ name: String }) },
      },
    };
    expect(modelUserPaths(connection as never)).toEqual([
      { name: 'A', paths: ['userId'] },
      { name: 'B', paths: [] },
    ]);
  });
});

describe('registryProblems', () => {
  const none = { covered: [], providers: [] };

  it('passes a model a provider covers and a model declared retained', () => {
    const models = [withPaths('Fav', 'userId'), withPaths('Sub', 'buyerUserId')];
    const registry = { covered: ['Fav'], providers: [{ name: 'favorites', models: ['Fav'] }] };

    expect(registryProblems(models, registry, [retain('Sub')])).toEqual([]);
  });

  it('ignores a model with no user path', () => {
    expect(registryProblems([withPaths('Auction')], none, [])).toEqual([]);
  });

  it('names the model that has a user path and no provider and no retained entry', () => {
    expect(registryProblems([withPaths('Lonely', 'userId', 'createdBy')], none, [])).toEqual([
      'Lonely: has userId, createdBy but no provider covers it and it is not declared retained (SC-27, BR-010-15)',
    ]);
  });

  it('fails a retained entry that names no model', () => {
    expect(registryProblems([], none, [retain('Ghost')])).toEqual([
      'retained entry Ghost: names no registered model (stale list)',
    ]);
  });

  it('fails a model both retained and claimed by a provider', () => {
    const models = [withPaths('Both', 'userId')];
    const registry = { covered: ['Both'], providers: [{ name: 'both', models: ['Both'] }] };

    expect(registryProblems(models, registry, [retain('Both')])).toEqual([
      'Both: is declared retained AND claimed by a provider',
    ]);
  });

  it('fails a provider that names a model nobody registered', () => {
    const registry = { covered: ['Nope'], providers: [{ name: 'broken', models: ['Nope'] }] };

    expect(registryProblems([], registry, [])).toEqual([
      'provider broken: names Nope, which is no registered model',
    ]);
  });
});
