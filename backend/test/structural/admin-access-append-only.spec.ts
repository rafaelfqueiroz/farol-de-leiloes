// SPEC-002 BR-002-27 / AR-30: the admin access log is append-only — no product action edits or
// deletes an entry, the admin's included — and a support access grant is never edited, only ended
// once (BR-002-26). Mongoose middleware on the log schema refuses updates at run time; this
// source-level check fails the build before such code exists:
//   1. only src/admin-access/ touches the two models: no other file imports their schemas or
//      repositories (AR-08, AR-09);
//   2. inside it, no call to an update/replace/delete/bulk method except the grant's end transition
//      (SupportAccessGrantRepository.endIfOpen and .endOpenForSupportRequest, one updateOne each);
//   3. that transition sets `status`, `endedAt` and `endReason` and nothing else;
//   4. AdminAccessLogRepository exposes `append` and nothing else.
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
});

describe('append-only detection', () => {
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
