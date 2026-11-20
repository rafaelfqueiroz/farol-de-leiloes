// SPEC-010 BR-010-15 / SC-27: the rule of the personal-data registry meta-test, as plain functions
// over what a connection registers and what the registry holds, so the rule's own failure modes are
// tested too (personal-data-coverage.spec.ts). Used by
// test/isolation/personal-data-registry.isolation.spec.ts.
//
// The rule: every Mongoose model with a path that names a person (`userId`, `requesterUserId`,
// `authorUserId`, `buyerUserId`, `adminUserId`, `createdBy`) is either covered by a provider of the
// registry (`models`: it is exported and purged) or declared in RETAINED_MODELS with its reason; and
// the registry itself tells the truth: a retained entry names a real model, a provider names real
// models, and no model is both purged and retained. Never a hand-kept list of models (TS-14's spirit).
import type { Connection, Schema } from 'mongoose';
import type { RetainedModel } from '../../src/privacy/registry/retained-models.js';

/** The schema paths that tie a record to a person. */
export const USER_PATHS = [
  'userId',
  'requesterUserId',
  'authorUserId',
  'buyerUserId',
  'adminUserId',
  'createdBy',
] as const;

export interface ModelUserPaths {
  readonly name: string;
  /** The user paths the model's schema has (possibly none). */
  readonly paths: readonly string[];
}

/** The user paths of one schema. */
export function userPathsOf(schema: Schema): string[] {
  return USER_PATHS.filter((path) => schema.path(path) !== undefined);
}

/** Every model the connection registered, with its user paths. */
export function modelUserPaths(connection: Pick<Connection, 'models'>): ModelUserPaths[] {
  return Object.entries(connection.models).map(([name, model]) => ({
    name,
    paths: userPathsOf(model.schema),
  }));
}

export interface RegistryView {
  /** The models some provider covers. */
  readonly covered: readonly string[];
  /** Each provider with the models it claims. */
  readonly providers: readonly { readonly name: string; readonly models: readonly string[] }[];
}

/** What is wrong with the registry as the models, the providers and the retained list stand. */
export function registryProblems(
  models: readonly ModelUserPaths[],
  registry: RegistryView,
  retained: readonly RetainedModel[],
): string[] {
  const problems: string[] = [];
  const known = new Set(models.map((model) => model.name));
  const retainedNames = new Set(retained.map((entry) => entry.model));

  for (const model of models) {
    if (model.paths.length === 0) continue;
    if (!registry.covered.includes(model.name) && !retainedNames.has(model.name)) {
      problems.push(
        `${model.name}: has ${model.paths.join(', ')} but no provider covers it and it is not declared retained (SC-27, BR-010-15)`,
      );
    }
  }
  for (const entry of retained) {
    if (!known.has(entry.model)) {
      problems.push(`retained entry ${entry.model}: names no registered model (stale list)`);
    }
    if (registry.covered.includes(entry.model)) {
      problems.push(`${entry.model}: is declared retained AND claimed by a provider`);
    }
  }
  for (const provider of registry.providers) {
    for (const model of provider.models) {
      if (!known.has(model)) {
        problems.push(`provider ${provider.name}: names ${model}, which is no registered model`);
      }
    }
  }
  return problems;
}
