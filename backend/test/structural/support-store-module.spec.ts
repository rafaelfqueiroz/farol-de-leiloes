// SPEC-009 / SPEC-002 BR-002-21: the support requests' source is bound in AccessModule through a LIGHT
// module that imports nothing but the Mongoose model. AccessModule is global and imported by AuthModule
// and by `npm run grant-admin`'s GrantAdminModule; if the store module imported auth, users or the admin
// code it would be an import cycle (AuthModule -> AccessModule -> store -> AuthModule) and grant-admin
// would drag the whole app in. Source-level, because the modules cannot be compiled in a unit test
// (ConfigModule validates the environment at import).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';

const SRC = join(import.meta.dirname, '..', '..', 'src');

/** The identifiers in the `imports` array of the file's @Module() decorator. */
function moduleImports(relative: string): string[] {
  const file = join(SRC, relative);
  const syntax = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  );
  const found: string[] = [];
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
            found.push(
              ts.isCallExpression(element)
                ? element.expression.getText(syntax)
                : element.getText(syntax),
            );
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return found;
}

describe('SupportRequestsStoreModule (SPEC-009: the light module AccessModule binds the source through)', () => {
  it('imports nothing but the Mongoose model: no auth, users, admin or config module, so no cycle', () => {
    expect(moduleImports('support/support-requests-store.module.ts')).toEqual([
      'MongooseModule.forFeature',
    ]);
  });

  it('is imported by AccessModule, and provides the source AccessModule binds', () => {
    expect(moduleImports('access/access.module.ts')).toContain('SupportRequestsStoreModule');
    const store = readFileSync(join(SRC, 'support/support-requests-store.module.ts'), 'utf8');
    expect(store).toMatch(/providers:\s*\[[^\]]*SupportRequestsSource/);
    expect(store).toMatch(/exports:\s*\[[^\]]*SupportRequestsSource/);
    expect(readFileSync(join(SRC, 'access/access.module.ts'), 'utf8')).toMatch(
      /provide: SUPPORT_REQUEST_SOURCE, useExisting: SupportRequestsSource/,
    );
  });
});
