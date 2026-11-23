// AR-12 / SPEC-009 (security review of #186): the repository methods that work across accounts or are
// the platform's own (the support outbox's claim, the purge, the cross-account reads) are named for it:
// `...ByJob`, `...ForJob`, `...AcrossAccounts`. A request handler must never call one, and a controller
// never touches a repository at all: it calls its service (AR-07, AR-08). Source-level, over the AST of
// every controller of src/.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join, sep } from 'path';
import * as ts from 'typescript';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const MARKED = /(ByJob|ForJob|AcrossAccounts|AcrossAccountsForJob|AcrossOwnersForJob)$/;

/** What a controller's source does that it must not: imports a repository, or calls a marked method. */
function controllerViolations(file: string, source: string): string[] {
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const at = (node: ts.Node) =>
    syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1;
  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      /\.repository(\.js)?$/.test(node.moduleSpecifier.text)
    ) {
      found.push(`${file}:${at(node)} imports ${node.moduleSpecifier.text}`);
    }
    if (ts.isPropertyAccessExpression(node) && MARKED.test(node.name.text)) {
      found.push(`${file}:${at(node)} uses .${node.name.text}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  return found;
}

describe('AR-12: no controller reaches a job-only or across-accounts repository method', () => {
  const controllers = (readdirSync(SRC, { recursive: true }) as string[]).filter(
    (file) => file.endsWith('.controller.ts') && !file.endsWith('.spec.ts'),
  );

  it('finds the controllers (the check is not looking at nothing), the support ones included', () => {
    const names = controllers.map((file) => file.split(sep).join('/'));
    expect(names).toEqual(
      expect.arrayContaining([
        'support/support.controller.ts',
        'support/support-contact.controller.ts',
      ]),
    );
  });

  it('none imports a repository or calls a ...ByJob / ...ForJob / ...AcrossAccounts method', () => {
    const offenders = controllers.flatMap((file) =>
      controllerViolations(file, readFileSync(join(SRC, file), 'utf8')),
    );
    expect(offenders).toEqual([]);
  });

  it('can fail: it flags a controller that does either', () => {
    const bad = [
      "import { SupportRequestsRepository } from './support-requests.repository.js';",
      'class C { constructor(private readonly r: R) {} go() { return this.r.claimDeliveryByJob(); } }',
      'class D { go() { return this.r.findByIdAcrossAccounts(); } }',
    ].join('\n');

    expect(controllerViolations('bad.controller.ts', bad)).toEqual([
      'bad.controller.ts:1 imports ./support-requests.repository.js',
      'bad.controller.ts:2 uses .claimDeliveryByJob',
      'bad.controller.ts:3 uses .findByIdAcrossAccounts',
    ]);
  });

  it('the support repository names every cross-account or platform method with the marker', () => {
    const source = readFileSync(join(SRC, 'support/support-requests.repository.ts'), 'utf8');
    const syntax = ts.createSourceFile('r.ts', source, ts.ScriptTarget.Latest, true);
    const publicMethods: string[] = [];
    syntax.forEachChild(function visit(node) {
      if (ts.isClassDeclaration(node)) {
        for (const member of node.members) {
          const modifiers = ts.canHaveModifiers(member) ? (ts.getModifiers(member) ?? []) : [];
          const isPublic = !modifiers.some(
            (modifier) =>
              modifier.kind === ts.SyntaxKind.PrivateKeyword ||
              modifier.kind === ts.SyntaxKind.ProtectedKeyword,
          );
          if (ts.isMethodDeclaration(member) && isPublic)
            publicMethods.push(member.name.getText(syntax));
        }
      }
      ts.forEachChild(node, visit);
    });

    // Everything that takes no AccessContext is marked; what takes one is the requester's own.
    expect(publicMethods.filter((name) => MARKED.test(name)).sort()).toEqual([
      'claimDeliveryByJob',
      'findByIdAcrossAccounts',
      'markMailSettledByJob',
      'purgeAccountByJob',
      'releaseClaimByJob',
    ]);
    expect(publicMethods.filter((name) => !MARKED.test(name)).sort()).toEqual([
      'createFor',
      'findAllForExport',
      'markDataAccessWithdrawn',
      'pageOf',
    ]);
  });
});
