// SPEC-002 BR-002-27 / BR-002-25: a support grant's view is reached only through GrantReadLogger, so
// no read under a grant can skip the admin access log. At run time the view is sealed in a WeakMap
// (src/admin-access/grant-context.ts) and SupportGrantRead has no property holding it; this source
// check fails the build before code exists that would open the seal elsewhere:
//   1. `grantContextOf` (opens the seal) is named only in grant-context.ts and grant-read-logger.ts;
//   2. `sealGrantContext` only in grant-context.ts and support-grant.service.ts;
//   3. `supportGrantView` (builds a view) only in access-context.ts and support-grant.service.ts;
//   4. grant-context.ts is imported only by those two admin-access files;
//   5. SupportGrantRead's public members are its four ids — no `context`, no getter.
// Production code only (src/, not *.spec.ts); the test helper test/support/grant-view.ts goes
// through GrantReadLogger.readOne like any route.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, sep } from 'path';
import * as ts from 'typescript';

const SRC = join(import.meta.dirname, '..', '..', 'src');

const ALLOWED: Record<string, readonly string[]> = {
  grantContextOf: ['admin-access/grant-context.ts', 'admin-access/grant-read-logger.ts'],
  sealGrantContext: ['admin-access/grant-context.ts', 'admin-access/support-grant.service.ts'],
  supportGrantView: ['access/access-context.ts', 'admin-access/support-grant.service.ts'],
};
const SEAL_IMPORTERS = [
  'admin-access/grant-read-logger.ts',
  'admin-access/support-grant.service.ts',
];

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
}

/** Every identifier (and string-keyed access) of the file naming one of `names`. */
function namesUsed(file: string, source: string, names: readonly string[]): string[] {
  const found: string[] = [];
  function visit(node: ts.Node): void {
    if ((ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) && names.includes(node.text)) {
      found.push(node.text);
    }
    if (ts.isStringLiteralLike(node) && names.includes(node.text)) found.push(node.text);
    ts.forEachChild(node, visit);
  }
  visit(parse(file, source));
  return found;
}

function importsOf(file: string, source: string): string[] {
  return parse(file, source).statements.flatMap((statement) =>
    (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
    statement.moduleSpecifier &&
    ts.isStringLiteral(statement.moduleSpecifier)
      ? [statement.moduleSpecifier.text]
      : [],
  );
}

/** The public instance members of a class: properties, methods and accessors. */
function publicMembers(file: string, source: string, className: string): string[] {
  const names: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node) && node.name?.text === className) {
      for (const member of node.members) {
        if (ts.isConstructorDeclaration(member)) {
          // Parameter properties (`constructor(readonly context: ...)`) are members too.
          for (const parameter of member.parameters) {
            const flags = ts.getCombinedModifierFlags(parameter);
            const isProperty = ts.isParameterPropertyDeclaration(parameter, member);
            if (
              isProperty &&
              (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) === 0
            ) {
              names.push(parameter.name.getText());
            }
          }
          continue;
        }
        const flags = ts.getCombinedModifierFlags(member as ts.Declaration);
        const hidden =
          (flags & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) !== 0 ||
          (member.name !== undefined && ts.isPrivateIdentifier(member.name));
        if (!hidden && member.name) names.push(member.name.getText());
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parse(file, source));
  return names;
}

describe('BR-002-27: the grant view is opened by GrantReadLogger only', () => {
  const files = (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => file.split(sep).join('/'));
  const read = (file: string) => readFileSync(join(SRC, file), 'utf8');

  it('finds the seal and its two users (the check is not looking at nothing)', () => {
    expect(files).toEqual(
      expect.arrayContaining([
        'admin-access/grant-context.ts',
        'admin-access/grant-read-logger.ts',
        'admin-access/support-grant.service.ts',
      ]),
    );
  });

  it.each(Object.entries(ALLOWED))('%s is named only where it belongs', (name, allowed) => {
    const users = files.filter((file) => namesUsed(file, read(file), [name]).length > 0);
    expect(users.sort()).toEqual([...allowed].sort());
  });

  it('grant-context.ts is imported only by the service and the logger', () => {
    const importers = files.filter((file) =>
      importsOf(file, read(file)).some((specifier) =>
        /(^|\/)grant-context(\.js)?$/.test(specifier),
      ),
    );
    expect(importers.sort()).toEqual([...SEAL_IMPORTERS].sort());
  });

  it('SupportGrantRead exposes its ids and no context', () => {
    const file = 'admin-access/support-grant.service.ts';
    expect(publicMembers(file, read(file), 'SupportGrantRead').sort()).toEqual(
      ['adminUserId', 'grantId', 'requesterUserId', 'supportRequestId'].sort(),
    );
  });
});

describe('seal detection', () => {
  it('finds a name as an identifier, a property, an import and a string key', () => {
    const source = [
      "import { grantContextOf } from './grant-context.js';",
      'const a = x.grantContextOf(r); const b = x["grantContextOf"];',
    ].join('\n');
    expect(namesUsed('x.ts', source, ['grantContextOf'])).toHaveLength(3);
  });

  it('lists public members, parameter properties included, but not private ones', () => {
    const source = [
      'class R {',
      '  readonly a: string;',
      '  private readonly b: string;',
      '  #c: string;',
      '  get d() { return 1; }',
      '  constructor(readonly e: string, private readonly f: string, g: string) {}',
      '}',
    ].join('\n');
    expect(publicMembers('x.ts', source, 'R').sort()).toEqual(['a', 'd', 'e']);
  });
});
