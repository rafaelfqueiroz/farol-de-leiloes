// SPEC-002 AR-16 / TS-14: the rules of the isolation gate, as plain functions over what a connection
// registers and what the isolation specs name, so the gate's own failure modes are tested too
// (../model-coverage.isolation.spec.ts).
//
// The specs are read with the TypeScript parser, as the structural specs read source: a model is
// named only by a real call `isolationSpecFor('<literal>', () => { ... })`, never by a comment or a
// string. A file holding such a call fails the gate when it skips, focuses or postpones tests
// (`.skip`, `.todo`, `.only`, `.skipIf`, `.runIf`, `.fails`, `xit`, `xdescribe`, ...), and so does a
// call whose body runs no `it(...)` / `test(...)`: a spec that proves nothing covers no model.
import { readdirSync, readFileSync } from 'fs';
import { join, relative } from 'path';
import type { Connection, Schema } from 'mongoose';
import * as ts from 'typescript';
import {
  type IsolationMark,
  isolationMarkOf,
  isOwnedSchema,
} from '../../../src/access/isolation-mark.js';

export const ISOLATION_DIR = join(import.meta.dirname, '..');
const SPEC_SUFFIX = '.isolation.spec.ts';
const NAMING_CALL = 'isolationSpecFor';

/**
 * Modifiers that make a spec prove less than it says: skipped, focused, expected to fail or not
 * written yet. Refused on anything (`it.skip`, `describe.only`, a test context's `ctx.skip()`).
 */
const WEAKENING_MODIFIERS = new Set(['skip', 'todo', 'only', 'skipIf', 'runIf', 'fails']);
/** Jasmine-style aliases that skip or focus. */
const WEAKENING_ALIASES = new Set(['xit', 'xtest', 'xdescribe', 'fit', 'fdescribe']);
/** The calls that are a test. */
const TESTS = new Set(['it', 'test']);

/** Every isolation spec file under `dir`, recursively, as absolute paths. */
export function isolationSpecFiles(dir: string = ISOLATION_DIR): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((file) => file.endsWith(SPEC_SUFFIX))
    .map((file) => join(dir, file))
    .sort();
}

export interface IsolationSpecScan {
  /** The models named by real `isolationSpecFor('<literal>', ...)` calls. */
  readonly models: string[];
  /** Why the file cannot count as covering them (TS-14); empty when it can. */
  readonly problems: string[];
}

/** The identifier a call chain starts from: `it` for `it.skip.each(...)`, `xit` for `xit(...)`. */
function rootName(expression: ts.Expression): string | undefined {
  let node: ts.Expression = expression;
  for (;;) {
    if (ts.isIdentifier(node)) return node.text;
    if (
      !ts.isPropertyAccessExpression(node) &&
      !ts.isElementAccessExpression(node) &&
      !ts.isCallExpression(node)
    ) {
      return undefined;
    }
    node = node.expression;
  }
}

/** Whether `node` holds a call to `it(...)` or `test(...)` (or `it.each(...)(...)`). */
function containsTest(node: ts.Node): boolean {
  let found = false;
  const visit = (child: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(child)) {
      const root = rootName(child.expression);
      if (root !== undefined && TESTS.has(root)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(child, visit);
  };
  ts.forEachChild(node, visit);
  return found;
}

/**
 * Reads one isolation spec's source with the TypeScript parser (TS-14): the models its real
 * `isolationSpecFor` calls name, and the problems that stop it from counting.
 */
export function scanIsolationSpec(source: string, file = 'spec.ts'): IsolationSpecScan {
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const at = (node: ts.Node) =>
    `${file}:${syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1}`;
  const models: string[] = [];
  const problems: string[] = [];
  const weakened: string[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && callee.text === NAMING_CALL) {
        const [name, body] = node.arguments;
        if (!name || !ts.isStringLiteralLike(name)) {
          problems.push(`${at(node)}: ${NAMING_CALL} names its model with a string literal`);
        } else if (!body || !containsTest(body)) {
          problems.push(`${at(node)}: ${NAMING_CALL}('${name.text}') runs no it(...) or test(...)`);
          models.push(name.text);
        } else {
          models.push(name.text);
        }
      }
      const root = rootName(callee);
      if (root !== undefined && WEAKENING_ALIASES.has(root)) {
        weakened.push(`${at(node)}: ${root}(...) skips or focuses tests`);
      }
    }
    if (ts.isPropertyAccessExpression(node) && WEAKENING_MODIFIERS.has(node.name.text)) {
      const root = rootName(node.expression) ?? '(expression)';
      weakened.push(`${at(node)}: ${root}.${node.name.text} skips, focuses or postpones tests`);
    }
    if (
      ts.isElementAccessExpression(node) &&
      ts.isStringLiteralLike(node.argumentExpression) &&
      WEAKENING_MODIFIERS.has(node.argumentExpression.text)
    ) {
      const root = rootName(node.expression) ?? '(expression)';
      weakened.push(
        `${at(node)}: ${root}['${node.argumentExpression.text}'] skips, focuses or postpones tests`,
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);

  // The skip and focus rules apply to the files that name a model: the gate trusts those.
  if (models.length > 0) problems.push(...weakened);
  return { models, problems };
}

/** The model names a spec's source names through real isolationSpecFor calls. */
export function modelsNamedIn(source: string): string[] {
  return scanIsolationSpec(source).models;
}

/** Every file's scan, relative to `dir` in the problem lines. */
function scans(dir: string): IsolationSpecScan[] {
  return isolationSpecFiles(dir).map((file) =>
    scanIsolationSpec(readFileSync(file, 'utf8'), relative(dir, file)),
  );
}

/**
 * Every model name the isolation specs under `dir` name, counting only files with no problem
 * (fail closed: a skipped or empty spec covers nothing).
 */
export function modelsWithIsolationSpec(dir: string = ISOLATION_DIR): Set<string> {
  return new Set(
    scans(dir)
      .filter((scan) => scan.problems.length === 0)
      .flatMap((scan) => scan.models),
  );
}

/** TS-14: every problem of every isolation spec under `dir`; the gate requires none. */
export function isolationSpecProblems(dir: string = ISOLATION_DIR): string[] {
  return scans(dir).flatMap((scan) => scan.problems);
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
