// SPEC-002 BR-002-21 (part 1 security review): grant-admin refuses an account with client
// relationships by reading the four access sources from ITS OWN Nest context (GrantAdminModule),
// not the API's. Both contexts must therefore resolve the same implementations. They do as long as
// the tokens are bound in AccessModule only, and both contexts import AccessModule: the API through
// AuthModule, grant-admin through GrantAdminModule. AppModule and GrantAdminModule cannot be
// compiled in a unit test (ConfigModule validates the environment at import), so this is a
// source-level check over the TypeScript AST.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const ACCESS_MODULE = join('access', 'access.module.ts');

const SOURCE_TOKENS = [
  'MEMBERSHIP_SOURCE',
  'CLIENT_LINK_SOURCE',
  'SELF_ADVISED_SOURCE',
  'OFFICE_PLAN_SOURCE',
  // SPEC-002 part 3: the support requests a grant hangs on (BR-002-24); bound here like the rest.
  'SUPPORT_REQUEST_SOURCE',
] as const;

/** `{ provide: TOKEN, ... }` and `.overrideProvider(TOKEN)` of the source tokens, as file:line token. */
function sourceBindings(file: string, source: string): string[] {
  const syntax = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const tokens = new Set<string>(SOURCE_TOKENS);
  const bindings: string[] = [];
  const record = (node: ts.Node, token: string) => {
    const { line } = syntax.getLineAndCharacterOfPosition(node.getStart(syntax));
    bindings.push(`${file}:${line + 1} ${token}`);
  };
  function visit(node: ts.Node): void {
    if (
      ts.isPropertyAssignment(node) &&
      node.name.getText(syntax) === 'provide' &&
      ts.isIdentifier(node.initializer) &&
      tokens.has(node.initializer.text)
    ) {
      record(node, node.initializer.text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'overrideProvider' &&
      node.arguments[0] &&
      ts.isIdentifier(node.arguments[0]) &&
      tokens.has(node.arguments[0].text)
    ) {
      record(node, node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return bindings;
}

/** The identifiers listed in the `imports` of the file's @Module() decorators. */
function moduleImports(file: string): string[] {
  const syntax = ts.createSourceFile(
    file,
    readFileSync(join(SRC, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'Module' &&
      node.arguments[0] &&
      ts.isObjectLiteralExpression(node.arguments[0])
    ) {
      for (const property of node.arguments[0].properties) {
        if (
          ts.isPropertyAssignment(property) &&
          property.name.getText(syntax) === 'imports' &&
          ts.isArrayLiteralExpression(property.initializer)
        ) {
          for (const element of property.initializer.elements) {
            if (ts.isIdentifier(element)) imports.push(element.text);
            // `...FEATURE_MODULES`: AppModule spreads the list of src/feature-modules.ts.
            if (ts.isSpreadElement(element) && ts.isIdentifier(element.expression)) {
              imports.push(`...${element.expression.text}`);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return imports;
}

/** The identifiers of the FEATURE_MODULES array of src/feature-modules.ts (SPEC-002 part 2). */
function featureModules(): string[] {
  const file = 'feature-modules.ts';
  const syntax = ts.createSourceFile(
    file,
    readFileSync(join(SRC, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const names: string[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isVariableDeclaration(node) &&
      node.name.getText(syntax) === 'FEATURE_MODULES' &&
      node.initializer &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      for (const element of node.initializer.elements) {
        if (ts.isIdentifier(element)) names.push(element.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return names;
}

describe('BR-002-21: the access sources are bound in AccessModule only', () => {
  const productionFiles = (readdirSync(SRC, { recursive: true }) as string[]).filter(
    (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
  );
  const bindings = productionFiles.flatMap((file) =>
    sourceBindings(file, readFileSync(join(SRC, file), 'utf8')),
  );

  it('binds each of the source tokens exactly once, in access/access.module.ts', () => {
    expect(bindings.filter((binding) => !binding.startsWith(`${ACCESS_MODULE}:`))).toEqual([]);
    for (const token of SOURCE_TOKENS) {
      expect(bindings.filter((binding) => binding.endsWith(` ${token}`))).toHaveLength(1);
    }
  });

  it.each([
    ['the API (AppModule imports AuthModule)', join('auth', 'auth.module.ts')],
    ['npm run grant-admin', join('access', 'grant-admin', 'grant-admin.module.ts')],
  ])('%s imports AccessModule, so it resolves the same bindings', (_label, file) => {
    expect(moduleImports(file)).toContain('AccessModule');
  });

  it('AppModule imports AuthModule (through FEATURE_MODULES)', () => {
    expect(moduleImports('app.module.ts')).toContain('...FEATURE_MODULES');
    expect(featureModules()).toContain('AuthModule');
  });
});

describe('access source binding detection', () => {
  it('finds a provider binding and a test override', () => {
    const source = [
      '@Module({ providers: [{ provide: MEMBERSHIP_SOURCE, useClass: OfficeMemberships }] })',
      'class OfficesModule {}',
      'builder.overrideProvider(OFFICE_PLAN_SOURCE).useValue(plans);',
    ].join('\n');

    expect(sourceBindings('offices/offices.module.ts', source)).toEqual([
      'offices/offices.module.ts:1 MEMBERSHIP_SOURCE',
      'offices/offices.module.ts:3 OFFICE_PLAN_SOURCE',
    ]);
  });

  it('ignores an injection and an unrelated token', () => {
    const source = [
      'constructor(@Inject(MEMBERSHIP_SOURCE) private readonly memberships: MembershipSource) {}',
      "const provider = { provide: 'OTHER', useValue: 1 };",
    ].join('\n');

    expect(sourceBindings('x.ts', source)).toEqual([]);
  });
});
