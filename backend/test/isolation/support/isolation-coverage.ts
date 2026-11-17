// SPEC-002 AR-16 / TS-14: the rules of the isolation gate, as plain functions over what a connection
// registers and what the isolation specs name, so the gate's own failure modes are tested too
// (../model-coverage.isolation.spec.ts).
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Connection, Schema } from 'mongoose';
import {
  type IsolationMark,
  isolationMarkOf,
  isOwnedSchema,
} from '../../../src/access/isolation-mark.js';

export const ISOLATION_DIR = join(import.meta.dirname, '..');
const SPEC_SUFFIX = '.isolation.spec.ts';

// isolationSpecFor('ModelName', ...) with a literal name; the name is what the gate counts.
const NAMED_MODEL = /isolationSpecFor\(\s*['"`]([A-Za-z0-9_]+)['"`]/g;

/** Every isolation spec file under `dir`, recursively, as absolute paths. */
export function isolationSpecFiles(dir: string = ISOLATION_DIR): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((file) => file.endsWith(SPEC_SUFFIX))
    .map((file) => join(dir, file))
    .sort();
}

/** The model names a spec's source names through isolationSpecFor. */
export function modelsNamedIn(source: string): string[] {
  return [...source.matchAll(NAMED_MODEL)].map((match) => match[1] ?? '');
}

/** Every model name the isolation specs under `dir` name. */
export function modelsWithIsolationSpec(dir: string = ISOLATION_DIR): Set<string> {
  return new Set(
    isolationSpecFiles(dir).flatMap((file) => modelsNamedIn(readFileSync(file, 'utf8'))),
  );
}

export interface ModelIsolation {
  readonly name: string;
  /** AR-16: the schema has an `ownerId` path. */
  readonly owned: boolean;
  readonly mark: IsolationMark | undefined;
}

export function isolationOf(name: string, schema: Schema): ModelIsolation {
  return { name, owned: isOwnedSchema(schema), mark: isolationMarkOf(schema) };
}

/** What a connection registers, model by model. */
export function modelIsolations(connection: Connection): ModelIsolation[] {
  return connection
    .modelNames()
    .sort()
    .map((name) => isolationOf(name, connection.model(name).schema as Schema));
}

/**
 * The gate (TS-14): one line per model that breaks it.
 * - owned (ownerId) with no isolation spec naming it (TS-13);
 * - marked 'account' (BR-002-02) with no isolation spec naming it;
 * - neither owned nor marked: every collection must say which class it is in (AR-16).
 */
export function coverageProblems(
  models: readonly ModelIsolation[],
  named: ReadonlySet<string>,
): string[] {
  return models.flatMap((model) => {
    if (model.owned) {
      return named.has(model.name)
        ? []
        : [`${model.name}: owned (ownerId) with no isolation spec naming it (TS-13, TS-14)`];
    }
    if (!model.mark) {
      return [`${model.name}: neither ownerId nor an isolation mark (AR-16: markIsolation)`];
    }
    if (model.mark.kind === 'account' && !named.has(model.name)) {
      return [`${model.name}: account data (BR-002-02) with no isolation spec naming it (TS-13)`];
    }
    return [];
  });
}
