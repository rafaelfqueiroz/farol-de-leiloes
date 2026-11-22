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

/** The schema paths that tie a record to a person, by name (the six of SC-27 and the ones SPEC-011 names). */
export const USER_PATHS = [
  'userId',
  'requesterUserId',
  'authorUserId',
  'buyerUserId',
  'adminUserId',
  'createdBy',
  'invitedBy',
  'memberUserId',
  'investorUserId',
] as const;

/**
 * Any path whose LAST segment names a person even if it is not in the list above: `...User`,
 * `...UserId`, `...UserIds`, `...Users` (`closedByUserId`, `reviewerUser`, `userIds`). Matched on the
 * segment, so `owner.userId`, `members.userId` and an array of ids `watcherUserIds` are all found.
 */
export const USER_PATH_PATTERN = /(^user|[a-z]User)(Ids?|s)?$/;

function isUserPath(path: string): boolean {
  const last = path.split('.').pop() ?? path;
  return (USER_PATHS as readonly string[]).includes(last) || USER_PATH_PATTERN.test(last);
}

/** The user paths of one schema, nested objects, arrays and sub-documents included, by full name. */
export function userPathsOf(schema: Schema, prefix = ''): string[] {
  const found: string[] = [];
  schema.eachPath((name, type) => {
    const full = `${prefix}${name}`;
    if (isUserPath(full)) found.push(full);
    // An array of sub-documents (`members: [{ userId }]`) or a single sub-document: look inside.
    const inner = (type as unknown as { schema?: Schema }).schema;
    if (inner) found.push(...userPathsOf(inner, `${full}.`));
  });
  return found;
}

export interface ModelUserPaths {
  readonly name: string;
  /** The user paths the model's schema has (possibly none). */
  readonly paths: readonly string[];
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
