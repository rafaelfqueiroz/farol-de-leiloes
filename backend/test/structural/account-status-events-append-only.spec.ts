// SPEC-009 BR-009-16, BR-009-17 / AR-30: the history of an account's deactivations and reactivations is
// insert-only: no product action edits or deletes an entry, the admin's included. Mongoose middleware on
// the schema refuses updates at run time (test/integration/account-status-events.spec.ts proves it on
// MongoDB); this source-level check fails the build before such code exists:
//   1. only src/admin-accounts/ names the model or the collection: no other file imports its schema or
//      repository, injects its model or spells 'accountStatusEvents' (the schema, migration 0013 and
//      the retained-models declaration aside, which name it without reading or writing it);
//   2. the repository exposes `append` and `historyOf`, and nothing else;
//   3. inside src/admin-accounts/ no call to an update, replace, delete, bulk or save method on
//      anything, and none that goes below Mongoose (`.collection`, `.db`, an injected connection to
//      reach the collection by name), except the transaction the status change opens (`connection
//      .transaction`, which touches no collection by itself).
//
// A source check of the application's own code; the control that also holds against a bug it cannot
// see is the database role of the API user (insert and find only on this collection), an owner action
// like the admin access log's (SECURITY.md SC-09).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, sep } from 'path';
import * as ts from 'typescript';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const MODULE_DIR = `admin-accounts${sep}`;
const REPOSITORY = 'admin-accounts/account-status-events.repository.ts';

const MUTATING_METHODS = new Set([
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findByIdAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'findByIdAndDelete',
  'findOneAndRemove',
  'findByIdAndRemove',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'remove',
  'bulkWrite',
  'save',
]);
/** Ways under Mongoose, refused inside the module (3). */
const UNDER_MONGOOSE = new Set(['collection', 'db']);

/** Files allowed to spell the model or the collection (1). */
const NAME_ALLOWED = [
  'admin-accounts/schemas/account-status-event.schema.ts',
  REPOSITORY,
  'migrations/0013-account-status-events-indexes.migration.ts',
  'privacy/registry/retained-models.ts',
];
/** The model class, the schema and the collection name as a string (a word, not part of a longer name). */
const NAMED = /\bAccountStatusEvent(Entity|Schema)\b|['"`]accountStatusEvents['"`]/;

function sourceFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => file.split(sep).join('/'));
}

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}

/** `file:line .method` of every call to a mutating method, and of every way under Mongoose. */
function mutationsIn(file: string, source: string): string[] {
  const syntax = parse(file, source);
  const found: string[] = [];
  const at = (node: ts.Node) =>
    syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1;
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      const name = node.name.text;
      if (MUTATING_METHODS.has(name)) found.push(`${file}:${at(node)} .${name}`);
      if (UNDER_MONGOOSE.has(name)) found.push(`${file}:${at(node)} .${name}`);
    }
    if (ts.isParameter(node) && node.type && /Connection/.test(node.type.getText(syntax))) {
      // `@InjectConnection()` is how a service opens a transaction: only the status service may.
      found.push(`${file}:${at(node)} a Connection parameter`);
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  return found;
}

describe('AR-30: the account status history is insert-only', () => {
  const files = sourceFiles();

  it('finds the module and its repository (the check is not looking at nothing)', () => {
    expect(files).toEqual(expect.arrayContaining([REPOSITORY]));
  });

  it('no file outside the schema, the repository, migration 0013 and the retained declaration names the model or the collection', () => {
    const offenders = files
      .filter((file) => !NAME_ALLOWED.includes(file))
      .filter((file) => {
        const source = readFileSync(join(SRC, file), 'utf8');
        return NAMED.test(source);
      });

    // The module wiring and the specs that build the module name the symbols to register the model.
    expect(offenders).toEqual(['admin-accounts/admin-accounts.module.ts']);
  });

  it('the repository exposes `append` and `historyOf` and nothing else', () => {
    const syntax = parse(REPOSITORY, readFileSync(join(SRC, REPOSITORY), 'utf8'));
    const publicMethods: string[] = [];
    syntax.forEachChild(function visit(node) {
      if (ts.isClassDeclaration(node)) {
        for (const member of node.members) {
          const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
          const isPrivate = modifiers.some(
            (modifier) =>
              modifier.kind === ts.SyntaxKind.PrivateKeyword ||
              modifier.kind === ts.SyntaxKind.ProtectedKeyword,
          );
          if (ts.isMethodDeclaration(member) && !isPrivate) {
            publicMethods.push(member.name.getText(syntax));
          }
        }
      }
      ts.forEachChild(node, visit);
    });

    expect(publicMethods.sort()).toEqual(['append', 'historyOf']);
  });

  it('nothing in src/admin-accounts/ updates, replaces, deletes, bulk-writes or saves, or goes below Mongoose', () => {
    const offenders = files
      .filter((file) => file.startsWith(MODULE_DIR.split(sep).join('/')))
      .flatMap((file) => mutationsIn(file, readFileSync(join(SRC, file), 'utf8')));

    // The status service injects the connection to open the transaction (a Connection parameter) and
    // nothing else; every other mutating call is absent.
    expect(offenders.map((offender) => offender.replace(/:\d+ /, ' '))).toEqual([
      'admin-accounts/account-status.service.ts a Connection parameter',
    ]);
  });

  it('can fail: it flags an update, a bulk write and a collection access', () => {
    const bad = [
      'class R { go() { return this.events.updateOne({}, {}); } }',
      'class S { go() { return this.events.bulkWrite([]); } }',
      "class T { go() { return this.connection.db.collection('x'); } }",
    ].join('\n');

    expect(mutationsIn('bad.ts', bad)).toEqual([
      'bad.ts:1 .updateOne',
      'bad.ts:2 .bulkWrite',
      'bad.ts:3 .collection',
      'bad.ts:3 .db',
    ]);
  });
});
