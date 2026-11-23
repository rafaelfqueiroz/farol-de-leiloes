// SPEC-002 BR-002-27 / AR-30: the admin access log is append-only — no product action edits or
// deletes an entry, the admin's included — and a support access grant is never edited, only ended
// once (BR-002-26). Mongoose middleware on the log schema refuses updates at run time; this
// source-level check fails the build before such code exists:
//   1. only src/admin-access/ touches the two models: no other file imports their schemas or
//      repositories (AR-08, AR-09);
//   2. inside it, no call to an update/replace/delete/bulk method except the grant's end transition
//      (SupportAccessGrantRepository.endIfOpen and .endOpenForSupportRequest, one updateOne each);
//   3. that transition sets `status`, `endedAt` and `endReason` and nothing else;
//   4. AdminAccessLogRepository exposes `append` and nothing else;
//   5. below Mongoose (the middleware does not see the driver): the collection names
//      'adminAccessLogs' and 'supportAccessGrants' appear as a string in src/ only in the schemas
//      and in migration 0005 (its indexes), so no code reaches them through
//      `connection.collection(...)`, `db.collection(...)` or an aggregation's `$merge`/`$out`;
//      `$merge` and `$out` appear nowhere in src/; no `drop`, `dropCollection`, `dropDatabase`,
//      `dropIndex(es)` or `renameCollection` call anywhere in src/; and inside src/admin-access/
//      no `.collection`, `.db` or `.connection` access and no injected connection, so the two
//      models are used through Mongoose only.
//
//   6. outside src/admin-access/ (the schemas, repositories and migration 0005 aside) no code looks
//      up, injects or names the two models or collections by any route: `connection.model(...)`,
//      `db.model(...)`, `mongoose.model(...)`, `connection.models.X`, `connection.collections`,
//      `@InjectModel(...)`, `getModelToken(...)`, `.collection(...)` on a connection or db, the
//      entity class symbols or their names as strings. Static spellings are resolved (literal,
//      template, `X.name`, same-file const, `+`); an argument that cannot be resolved is refused
//      too, except in the allowlisted files below. test/structural/module-model-boundary.spec.ts
//      (AR-09) already refuses `connection.model` for every model; this check is still needed
//      because it also covers the collection and token routes, the registry maps and the
//      driver, and names the two protected models (a #161 review P2: a service in src/ deleted a
//      persisted entry through `connection.model('AdminAccessLogEntity').collection`).
//
// This is a source check of the application's own code. The control that also holds against a
// bug it cannot see is the database role of the API user: insert and find only on adminAccessLogs
// (SECURITY.md SC-09, an owner action on Atlas).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, sep } from 'path';
import * as ts from 'typescript';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const MODULE_DIR = `admin-access${sep}`;

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

/** `Class.method` of the end transition, the only mutating calls allowed. */
const END_TRANSITION = [
  'SupportAccessGrantRepository.endIfOpen updateOne',
  'SupportAccessGrantRepository.endOpenForSupportRequest updateOne',
];
const END_TRANSITION_FIELDS = ['endReason', 'endedAt', 'status'];

/** Only these files may spell the two collection names (5). */
const COLLECTION_NAMES = ['adminAccessLogs', 'supportAccessGrants'];
const NAME_ALLOWED = [
  'admin-access/schemas/admin-access-log.schema.ts',
  'admin-access/schemas/support-access-grant.schema.ts',
  'migrations/0005-admin-access-indexes.migration.ts',
  // SPEC-010 BR-010-23: the purge's declared list of RETAINED models names both, as strings, to say
  // they are kept; it never reads or writes them. The registry reads a provider's own `models` list
  // (model NAMES it purges), which is not Mongoose's `connection.models` registry.
  'privacy/registry/retained-models.ts',
  'privacy/registry/personal-data-registry.ts',
];
/** Aggregation stages that write a collection, refused everywhere in src/ (5). */
const WRITING_STAGES = ['$merge', '$out'];
/** Driver calls that destroy or move a collection or its indexes, refused everywhere (5). */
const DESTRUCTIVE_CALLS = new Set([
  'drop',
  'dropCollection',
  'dropDatabase',
  'dropIndex',
  'dropIndexes',
  'renameCollection',
]);
/** Ways under Mongoose, refused inside src/admin-access/ (5). */
const UNDER_MONGOOSE = new Set(['collection', 'db', 'connection']);

/** The two protected models (class names) and, via COLLECTION_NAMES, their collections (6). */
const PROTECTED_MODELS = ['AdminAccessLogEntity', 'SupportAccessGrantEntity'];
/** Lookups whose argument names a model or a collection (6). */
const NAMING_CALLS = new Set(['model', 'collection', 'getModelToken', 'InjectModel']);
/** Registry maps that reach every model or collection without naming one (6). */
const REGISTRY_MEMBERS = new Set(['models', 'collections', 'modelNames']);
/**
 * Files outside admin-access allowed a `.collection(<non-literal>)` that cannot be resolved
 * statically (6). 0001 iterates a fixed list of money collections, 0006 a fixed record of the
 * plans, subscriptions and paymentEvents indexes, 0007 one of the subscriptions and ownerCounters
 * indexes, 0008 one of the consents and whatsappConsents indexes and 0009 one of the dataExports,
 * actorPseudonyms and users indexes and 0010 one of the retentionDeletions and legalValidations
 * indexes and 0012 one of the auctions, importruns and propertychanges indexes, none of the two
 * protected ones.
 */
const UNRESOLVED_ALLOWED = [
  'migrations/0001-money-decimal128.migration.ts',
  'migrations/0006-subscription-indexes.migration.ts',
  'migrations/0007-billing-indexes.migration.ts',
  'migrations/0008-consent-indexes.migration.ts',
  'migrations/0009-privacy-rights-indexes.migration.ts',
  'migrations/0010-retention-legal-indexes.migration.ts',
  'migrations/0012-auction-import-model.migration.ts',
];

const PRIVATE_PATHS = [
  'admin-access/schemas/',
  'admin-access/admin-access-log.repository',
  'admin-access/support-access-grant.repository',
];

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}

/** The `Class.method` a node sits in, or `(top level)`. */
function enclosingMember(node: ts.Node): string {
  let method = '';
  for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
    if (!method && ts.isMethodDeclaration(current)) method = current.name.getText();
    if (ts.isClassDeclaration(current)) {
      return `${current.name?.text ?? '(class)'}.${method || '(field)'}`;
    }
  }
  return method || '(top level)';
}

interface MutatingCall {
  readonly where: string;
  /** The keys of a `{ $set: { ... } }` object passed to the call, if any. */
  readonly setFields: readonly string[] | null;
}

/** Every `x.<mutating method>(...)` of the file, as `Class.method call`. */
function mutatingCalls(file: string, source: string): MutatingCall[] {
  const syntax = parse(file, source);
  const calls: MutatingCall[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      MUTATING_METHODS.has(node.expression.name.text)
    ) {
      calls.push({
        where: `${enclosingMember(node)} ${node.expression.name.text}`,
        setFields: setFieldsOf(node.arguments[1]),
      });
    }
    // `x['updateOne'](...)`: the bracket spelling is refused outright.
    if (
      ts.isCallExpression(node) &&
      ts.isElementAccessExpression(node.expression) &&
      ts.isStringLiteralLike(node.expression.argumentExpression) &&
      MUTATING_METHODS.has(node.expression.argumentExpression.text)
    ) {
      calls.push({ where: `${enclosingMember(node)} [bracket]`, setFields: null });
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return calls;
}

function setFieldsOf(update: ts.Expression | undefined): string[] | null {
  if (!update || !ts.isObjectLiteralExpression(update)) return null;
  const set = update.properties.find(
    (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === '$set',
  );
  if (!set || update.properties.length !== 1 || !ts.isObjectLiteralExpression(set.initializer)) {
    return null;
  }
  return set.initializer.properties.map((p) => p.name?.getText() ?? '(spread)').sort();
}

/** The non-private method names of a class declared in the file. */
function publicMethods(file: string, source: string, className: string): string[] {
  const syntax = parse(file, source);
  const names: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      for (const member of node.members) {
        const flags = ts.getCombinedModifierFlags(member as ts.Declaration);
        const isPrivate =
          (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0 ||
          (member.name !== undefined && ts.isPrivateIdentifier(member.name));
        if (
          (ts.isMethodDeclaration(member) ||
            ts.isPropertyDeclaration(member) ||
            ts.isGetAccessorDeclaration(member)) &&
          !isPrivate
        ) {
          names.push(member.name.getText());
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return names;
}

/** Module specifiers of the file's imports and re-exports. */
function importsOf(file: string, source: string): string[] {
  const syntax = parse(file, source);
  return syntax.statements.flatMap((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
}

/** Every string literal of the file (plain, template head/middle/tail, and property names). */
function stringsOf(file: string, source: string): { text: string; line: number }[] {
  const syntax = parse(file, source);
  const found: { text: string; line: number }[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push({
        text: node.text,
        line: syntax.getLineAndCharacterOfPosition(node.getStart()).line + 1,
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return found;
}

/** The string an argument statically spells (literal, template, `X.name`, same-file const, `+`). */
function resolveText(
  expression: ts.Expression,
  consts: ReadonlyMap<string, ts.Expression>,
  seen: ReadonlySet<string> = new Set(),
): string | null {
  let node = expression;
  while (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    for (const span of node.templateSpans) {
      const inner = resolveText(span.expression, consts, seen);
      if (inner === null) return null;
      text += inner + span.literal.text;
    }
    return text;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = resolveText(node.left, consts, seen);
    const right = resolveText(node.right, consts, seen);
    return left === null || right === null ? null : left + right;
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'name' &&
    ts.isIdentifier(node.expression)
  ) {
    return node.expression.text; // `Entity.name` is the class name
  }
  const initializer = ts.isIdentifier(node) ? consts.get(node.text) : undefined;
  if (ts.isIdentifier(node) && initializer && !seen.has(node.text)) {
    return resolveText(initializer, consts, new Set([...seen, node.text]));
  }
  return null;
}

/** (6) A protected model or collection looked up, injected or named outside the module. */
function protectedUses(
  syntax: ts.SourceFile,
  file: string,
  at: (node: ts.Node) => number,
): BypassUse[] {
  const uses: BypassUse[] = [];
  const consts = new Map<string, ts.Expression>();
  const collect = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.getCombinedNodeFlags(node) & ts.NodeFlags.Const
    ) {
      consts.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collect);
  };
  collect(syntax);
  const protectedNames = [...PROTECTED_MODELS, ...COLLECTION_NAMES];
  const unresolvedAllowed = UNRESOLVED_ALLOWED.some((path) => file.split(sep).join('/') === path);
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) && PROTECTED_MODELS.includes(node.text)) {
      uses.push({ what: `${node.text} (symbol)`, line: at(node) });
    }
    if (
      (ts.isPropertyAccessExpression(node) && REGISTRY_MEMBERS.has(node.name.text)) ||
      (ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        REGISTRY_MEMBERS.has(node.argumentExpression.text))
    ) {
      const member = ts.isPropertyAccessExpression(node)
        ? node.name.text
        : (node.argumentExpression as ts.StringLiteralLike).text;
      uses.push({ what: `.${member} (registry)`, line: at(node) });
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : ts.isPropertyAccessExpression(callee)
          ? callee.name.text
          : ts.isElementAccessExpression(callee) &&
              ts.isStringLiteralLike(callee.argumentExpression)
            ? callee.argumentExpression.text
            : null;
      if (name && NAMING_CALLS.has(name)) {
        const argument = node.arguments[0];
        const text = argument ? resolveText(argument, consts) : null;
        if (text === null) {
          if (!unresolvedAllowed) uses.push({ what: `${name}(<unresolved>)`, line: at(node) });
        } else if (protectedNames.some((protectedName) => text.includes(protectedName))) {
          uses.push({ what: `${name}('${text}')`, line: at(node) });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  return uses;
}

interface BypassUse {
  readonly what: string;
  readonly line: number;
}

/** (5) A collection name, a writing stage, a destructive call, or (in the module) a way under Mongoose. */
function bypassesOf(file: string, source: string, inModule: boolean, nameAllowed: boolean) {
  const syntax = parse(file, source);
  const uses: BypassUse[] = [];
  const at = (node: ts.Node) => syntax.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  for (const { text, line } of stringsOf(file, source)) {
    if (!nameAllowed) {
      for (const name of COLLECTION_NAMES) {
        if (text.includes(name)) uses.push({ what: `'${name}'`, line });
      }
      for (const name of PROTECTED_MODELS) {
        if (text.includes(name)) uses.push({ what: `'${name}'`, line });
      }
    }
    for (const stage of WRITING_STAGES) {
      if (text.includes(stage)) uses.push({ what: stage, line });
    }
  }
  function visit(node: ts.Node): void {
    // `{ $merge: ... }` written as an identifier-like property name.
    if (ts.isIdentifier(node) && WRITING_STAGES.includes(node.text)) {
      uses.push({ what: node.text, line: at(node) });
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
          ? callee.argumentExpression.text
          : null;
      if (name && DESTRUCTIVE_CALLS.has(name)) uses.push({ what: `${name}()`, line: at(node) });
    }
    if (inModule) {
      if (ts.isPropertyAccessExpression(node) && UNDER_MONGOOSE.has(node.name.text)) {
        uses.push({ what: `.${node.name.text}`, line: at(node) });
      }
      if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression) &&
        UNDER_MONGOOSE.has(node.argumentExpression.text)
      ) {
        uses.push({ what: `['${node.argumentExpression.text}']`, line: at(node) });
      }
      if (ts.isIdentifier(node) && ['InjectConnection', 'getConnectionToken'].includes(node.text)) {
        uses.push({ what: node.text, line: at(node) });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  if (!inModule && !nameAllowed) uses.push(...protectedUses(syntax, file, at));
  return uses;
}

describe('BR-002-27 / AR-30: the admin access log is append-only, a grant only ends', () => {
  const files = (readdirSync(SRC, { recursive: true }) as string[]).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
  );
  const read = (file: string) => readFileSync(join(SRC, file), 'utf8');
  const moduleFiles = files.filter((file) => file.startsWith(MODULE_DIR));

  it('finds the module (the check is not looking at nothing)', () => {
    expect(moduleFiles.map((file) => file.split(sep).join('/'))).toEqual(
      expect.arrayContaining([
        'admin-access/admin-access-log.repository.ts',
        'admin-access/support-access-grant.repository.ts',
      ]),
    );
  });

  it('no file outside src/admin-access imports its schemas or repositories', () => {
    const offenders = files
      .filter((file) => !file.startsWith(MODULE_DIR))
      .flatMap((file) =>
        importsOf(file, read(file))
          .filter((specifier) => PRIVATE_PATHS.some((path) => specifier.includes(path)))
          .map((specifier) => `${file}: ${specifier}`),
      );
    expect(offenders).toEqual([]);
  });

  it('no update, replace, delete or bulk write but the grant’s end transition', () => {
    const calls = moduleFiles.flatMap((file) =>
      mutatingCalls(file, read(file)).map((call) => ({ ...call, file })),
    );
    expect(calls.map((call) => call.where).sort()).toEqual([...END_TRANSITION].sort());
    for (const call of calls) {
      expect(call.file.split(sep).join('/')).toBe(
        'admin-access/support-access-grant.repository.ts',
      );
      expect(call.setFields, `${call.where} sets only the end fields`).toEqual(
        END_TRANSITION_FIELDS,
      );
    }
  });

  it('AdminAccessLogRepository exposes append and nothing else', () => {
    const file = join('admin-access', 'admin-access-log.repository.ts');
    expect(publicMethods(file, read(file), 'AdminAccessLogRepository')).toEqual(['append']);
  });

  it('nothing reaches the two collections below Mongoose (driver, $merge/$out, drop)', () => {
    const allowed = new Set(NAME_ALLOWED.map((path) => path.split('/').join(sep)));
    const offenders = files.flatMap((file) =>
      bypassesOf(file, read(file), file.startsWith(MODULE_DIR), allowed.has(file)).map(
        (use) => `${file.split(sep).join('/')}:${use.line} ${use.what}`,
      ),
    );
    expect(offenders).toEqual([]);
    // The allowed files exist (the allowlist is not stale).
    for (const path of allowed) expect(files).toContain(path);
  });
});

describe('append-only detection', () => {
  it('finds the collection names, writing stages, destructive calls and ways under Mongoose', () => {
    const source = [
      "connection.collection('adminAccessLogs').deleteMany({});",
      "model.aggregate([{ $match: {} }, { $merge: { into: 'x' } }, { '$out': 'y' }]);",
      'await db.dropCollection(name); await model.collection.drop(); x["dropIndexes"]();',
      'class R { constructor(@InjectConnection() private readonly c) {} a() { this.m.db; } }',
    ].join('\n');

    expect(
      bypassesOf('x.ts', source, true, false)
        .map((use) => use.what)
        .sort(),
    ).toEqual(
      [
        "'adminAccessLogs'",
        '$merge',
        '$out',
        'dropCollection()',
        'drop()',
        'dropIndexes()',
        '.collection',
        '.collection',
        '.db',
        'InjectConnection',
      ].sort(),
    );
    // Outside the module only the names, the stages and the destructive calls count; an allowed
    // file may spell the names.
    expect(
      bypassesOf('x.ts', source, false, true)
        .map((use) => use.what)
        .sort(),
    ).toEqual(['$merge', '$out', 'dropCollection()', 'drop()', 'dropIndexes()'].sort());
  });

  it('ignores the names in comments and ordinary driver reads elsewhere', () => {
    const source = [
      '// adminAccessLogs is append-only; never $merge into it',
      "db.collection('users').find({});",
    ].join('\n');
    expect(bypassesOf('x.ts', source, false, false)).toEqual([]);
  });

  it('finds a mutating call, the class and method it sits in, and the $set fields', () => {
    const source = [
      'class LogRepository {',
      '  async fix(id) { await this.logs.updateOne({ _id: id }, { $set: { at: 1 } }); }',
      '  async drop() { await this.logs.deleteMany({}); await this.logs["bulkWrite"]([]); }',
      '}',
      'model.findOneAndUpdate({}, { $inc: { n: 1 } });',
    ].join('\n');

    expect(mutatingCalls('x.ts', source)).toEqual([
      { where: 'LogRepository.fix updateOne', setFields: ['at'] },
      { where: 'LogRepository.drop deleteMany', setFields: null },
      { where: 'LogRepository.drop [bracket]', setFields: null },
      { where: '(top level) findOneAndUpdate', setFields: null },
    ]);
  });

  it('ignores reads and inserts', () => {
    const source = 'class R { a() { this.m.find({}); this.m.insertMany([]); this.m.create([]); } }';
    expect(mutatingCalls('x.ts', source)).toEqual([]);
  });

  it('lists the public methods of a class, not its private or protected ones', () => {
    const source = [
      'class R {',
      '  constructor(private readonly m) {}',
      '  append() {}',
      '  update() {}',
      '  private helper() {}',
      '  protected other() {}',
      '  #hidden() {}',
      '}',
    ].join('\n');
    expect(publicMethods('x.ts', source, 'R')).toEqual(['append', 'update']);
  });
});

// #161 review P2: a service anywhere in src/ reached the log's driver collection through the
// connection's model registry and deleted a persisted entry. Each spelling below must be reported
// in an ordinary file outside the module.
const OWNER_SPELLING = [
  "import { Injectable } from '@nestjs/common';",
  "import { InjectConnection } from '@nestjs/mongoose';",
  "import { Connection } from 'mongoose';",
  '@Injectable()',
  'export class CleanupService {',
  '  constructor(@InjectConnection() private readonly connection: Connection) {}',
  '  async purge(): Promise<void> {',
  '    await this.connection',
  "      .model('AdminAccessLogEntity')",
  '      .collection.deleteMany({});',
  '  }',
  '}',
].join('\n');

describe('append-only detection: the protected models outside their module (#161 review P2)', () => {
  const outside = (source: string) =>
    bypassesOf('cleanup/cleanup.service.ts', source, false, false).map((use) => use.what);

  it.each([
    ['the owner’s connection.model spelling', OWNER_SPELLING],
    ['@InjectModel(Entity.name)', '@InjectModel(AdminAccessLogEntity.name) private readonly l;'],
    ["@InjectModel('Entity')", "@InjectModel('SupportAccessGrantEntity') private readonly g;"],
    ["getModelToken('Entity')", "app.get(getModelToken('AdminAccessLogEntity'));"],
    ['getModelToken(Entity.name)', 'app.get(getModelToken(SupportAccessGrantEntity.name));'],
    ['connection.models.Entity', 'connection.models.AdminAccessLogEntity.collection.drop2();'],
    ["connection.models['Entity']", "connection.models['SupportAccessGrantEntity'];"],
    ['mongoose.model(...)', "mongoose.model('AdminAccessLogEntity');"],
    ['a renamed connection', 'this.conn.model(`AdminAccessLogEntity`).collection.deleteMany({});'],
    ['a concatenated model name', "this.db.model('AdminAccess' + 'LogEntity');"],
    ['a template model name', "connection.model(`AdminAccess${'LogEntity'}`);"],
    ['a model name held in a constant', "const N = 'AdminAccessLogEntity'; connection.model(N);"],
    ["connection.db.collection('name')", "connection.db.collection('adminAccessLogs');"],
    ['a concatenated collection name', "connection.collection('adminAccess' + 'Logs');"],
    ['a template collection name', 'connection.db.collection(`supportAccess${"Grants"}`);'],
    ['connection.collections.name', 'connection.collections.adminAccessLogs.deleteMany({});'],
    ['a non-literal model lookup', 'connection.model(name).collection.deleteMany({});'],
    ['a non-literal collection', 'this.connection.db.collection(name).deleteMany({});'],
    ['a non-literal model token', 'app.get(getModelToken(name));'],
    ['a non-literal injected model', '@InjectModel(name) private readonly m;'],
    ['an unresolved template', 'connection.model(`${prefix}LogEntity`);'],
    ['the registry enumerated', 'Object.values(connection.models).map((m) => m.collection);'],
    ['the model names listed', 'connection.modelNames().forEach((n) => n);'],
    [
      'an import of the model class',
      "import { AdminAccessLogEntity } from '../admin-access/schemas/admin-access-log.schema';",
    ],
  ])('reports %s', (_name, source) => {
    expect(outside(source)).not.toEqual([]);
  });
});

describe('append-only detection: what stays allowed (#161 review P2)', () => {
  it('lets an admin-access repository inject and use its own model', () => {
    const source = [
      "import { InjectModel } from '@nestjs/mongoose';",
      "import { AdminAccessLogEntity } from './schemas/admin-access-log.schema';",
      'class AdminAccessLogRepository {',
      '  constructor(@InjectModel(AdminAccessLogEntity.name) private readonly logs) {}',
      '  append(entry) { return this.logs.create(entry); }',
      '}',
    ].join('\n');
    expect(bypassesOf('admin-access/admin-access-log.repository.ts', source, true, true)).toEqual(
      [],
    );
  });

  it.each([
    '@InjectModel(JobExecution.name) private readonly jobs;',
    "const COLLECTION = 'users'; db.collection(COLLECTION).find({});",
    "app.get(getModelToken('UserEntity'));",
    "connection.model('UserEntity');",
  ])('lets other models and collections through outside the module: %s', (source) => {
    expect(bypassesOf('jobs/jobs.service.ts', source, false, false)).toEqual([]);
  });
});
