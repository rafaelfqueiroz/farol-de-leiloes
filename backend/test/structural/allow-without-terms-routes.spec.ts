// SPEC-010 BR-010-05, DL-010-03: `@AllowWithoutTerms()` is the one way past the current-terms guard,
// so the set of routes that carry it is pinned here, exactly. Widening it is a decision a reviewer
// must see: adding a route (or a whole controller) to the list below is a change of this file, and
// the build fails until it is. The set is what an account must reach without having accepted the
// newest version: who am I, sign out, reading and correcting its own data (BR-010-08, BR-010-12),
// the legal texts, and the privacy routes (accepting, the account's acceptances, its consent).
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as ts from 'typescript';

const SRC = join(import.meta.dirname, '..', '..', 'src');

/** `<file>#<Class>` for a whole controller, `<file>#<Class>.<method>` for one handler. */
const PINNED = [
  'auth/auth.controller.ts#AuthController.getFullProfile', // GET  /auth/profile/full
  'auth/auth.controller.ts#AuthController.getProfile', //     GET  /auth/me
  'auth/auth.controller.ts#AuthController.logout', //         POST /auth/logout
  'auth/auth.controller.ts#AuthController.updateProfile', //  PATCH /auth/profile
  'privacy/legal.controller.ts#LegalController', //           /legal/*
  'privacy/privacy.controller.ts#PrivacyController', //       /privacy/*
  'privacy/rights/privacy-rights.controller.ts#PrivacyRightsController', // /privacy/* (SPEC-010 BR-010-08..14)
];

const sources = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
  .map((file) => ({
    file: file.split('\\').join('/'),
    text: readFileSync(join(SRC, file), 'utf8'),
  }));

const carriesAllowWithoutTerms = (node: ts.HasDecorators): boolean =>
  (ts.getDecorators(node) ?? []).some((decorator) => {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression;
    return ts.isIdentifier(expression) && expression.text === 'AllowWithoutTerms';
  });

/** Every class or method of `source` decorated with `@AllowWithoutTerms()`. */
export function exemptions(file: string, source: string): string[] {
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) {
      const name = node.name?.text ?? '(anonymous)';
      if (carriesAllowWithoutTerms(node)) found.push(`${file}#${name}`);
      for (const member of node.members) {
        if (ts.isMethodDeclaration(member) && carriesAllowWithoutTerms(member)) {
          found.push(`${file}#${name}.${member.name.getText(syntax)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(syntax);
  return found;
}

describe('SPEC-010 DL-010-03: the routes exempt from the current-terms guard are pinned', () => {
  const used = sources.flatMap(({ file, text }) => exemptions(file, text));

  it('is exactly auth/me, auth/logout, the profile pair, /legal/* and /privacy/*', () => {
    expect([...used].sort()).toEqual([...PINNED].sort());
  });

  it('the decorator is defined once, in privacy/decorators', () => {
    const definitions = sources
      .filter(({ text }) => /export const AllowWithoutTerms\b/.test(text))
      .map(({ file }) => file);
    expect(definitions).toEqual(['privacy/decorators/allow-without-terms.decorator.ts']);
  });

  it('nothing sets its metadata by hand, or reads it outside the guard', () => {
    const offenders = sources
      .filter(({ file }) => !file.startsWith('privacy/'))
      .filter(({ text }) => /ALLOW_WITHOUT_TERMS|privacy:allow-without-terms/.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});

describe('the scan finds what it should', () => {
  it('finds a class, a handler, and ignores an undecorated one and a comment', () => {
    const source = [
      '// @AllowWithoutTerms() in a comment',
      '@AllowWithoutTerms()',
      "@Controller('a') class A {}",
      "@Controller('b') class B {",
      '  @AllowWithoutTerms()',
      '  one() {}',
      '  two() {}',
      '}',
    ].join('\n');
    expect(exemptions('x.ts', source)).toEqual(['x.ts#A', 'x.ts#B.one']);
  });
});
