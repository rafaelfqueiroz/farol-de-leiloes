// SC-07 (SPEC-002 part 1 security review): an access requirement always wins over @Public()
// (isPublicRoute in auth/decorators/public.decorator.ts), so a route can never be opened by a
// misplaced @Public(). This scan keeps the source honest about it: a controller or handler never
// says both, and a @Public() handler never sits in a controller with a requirement (its @Public()
// would be dead). A handler-level requirement in a @Public() controller is fine: that handler
// authenticates and the others stay public.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

const SRC = join(import.meta.dirname, '..', '..', 'src');

/** The SPEC-002 access decorators, and the marker they set (REQUIRES_ACCESS). */
const ACCESS_DECORATORS = new Set([
  'AdminOnly',
  'RequiresPersona',
  'RequiresEntitlement',
  'RequiresAccess',
]);

function decoratorNames(node: ts.HasDecorators): string[] {
  return (ts.getDecorators(node) ?? []).flatMap((decorator) => {
    const expression = ts.isCallExpression(decorator.expression)
      ? decorator.expression.expression
      : decorator.expression;
    return ts.isIdentifier(expression) ? [expression.text] : [];
  });
}

const isPublic = (names: string[]) => names.includes('Public');
const hasRequirement = (names: string[]) => names.some((name) => ACCESS_DECORATORS.has(name));

function publicAccessConflicts(file: string, source: string): string[] {
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const conflicts: string[] = [];
  const at = (node: ts.Node) =>
    syntax.getLineAndCharacterOfPosition(node.getStart(syntax)).line + 1;

  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node)) {
      const name = node.name?.text ?? '(anonymous)';
      const onClass = decoratorNames(node);
      if (isPublic(onClass) && hasRequirement(onClass)) {
        conflicts.push(`${file}:${at(node)}: ${name} has @Public() and an access requirement`);
      }
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        const onMethod = decoratorNames(member);
        if (!isPublic(onMethod)) continue;
        const method = `${name}.${member.name.getText(syntax)}`;
        if (hasRequirement(onMethod)) {
          conflicts.push(
            `${file}:${at(member)}: ${method} has @Public() and an access requirement`,
          );
        } else if (hasRequirement(onClass)) {
          conflicts.push(
            `${file}:${at(member)}: ${method} is @Public() in a controller with an access requirement`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return conflicts;
}

describe('SC-07: @Public() is never combined with an access requirement', () => {
  it('holds for every production controller', () => {
    const conflicts = (readdirSync(SRC, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .flatMap((file) => publicAccessConflicts(file, readFileSync(join(SRC, file), 'utf8')));

    expect(conflicts).toEqual([]);
  });
});

describe('public/access conflict detection', () => {
  it.each([
    [
      'both on one handler',
      `class C {\n  @Public()\n  @AdminOnly()\n  route() {}\n}`,
      'x.ts:2: C.route has @Public() and an access requirement',
    ],
    [
      'both on one controller',
      `@Public()\n@RequiresPersona('advisor')\n@Controller('c')\nclass C {}`,
      'x.ts:1: C has @Public() and an access requirement',
    ],
    [
      'a @Public() handler in a controller with a requirement',
      `@RequiresEntitlement('journeys')\nclass C {\n  @Public()\n  route() {}\n}`,
      'x.ts:3: C.route is @Public() in a controller with an access requirement',
    ],
  ])('rejects %s', (_label, source, conflict) => {
    expect(publicAccessConflicts('x.ts', source)).toEqual([conflict]);
  });

  it.each([
    [
      'a requirement on a handler of a @Public() controller',
      `@Public()\nclass C {\n  @AdminOnly()\n  route() {}\n}`,
    ],
    [
      'a @Public() handler beside a guarded one',
      `class C {\n  @Public()\n  a() {}\n  @AdminOnly()\n  b() {}\n}`,
    ],
    ['neither', `class C {\n  @Get()\n  route() {}\n}`],
  ])('allows %s', (_label, source) => {
    expect(publicAccessConflicts('x.ts', source)).toEqual([]);
  });
});
