// #63: the backend runs as native ESM, where `import * as X from 'pkg'` binds the namespace Node
// builds for the package — and for a CommonJS package that is only what cjs-module-lexer can see
// statically. A UMD bundle such as papaparse exposes nothing but `default`, so `Papa.parse` is
// undefined at run time while tsc (whose types are ES-style) and Vitest (whose interop fills the
// namespace in) both stay green. These helpers find each namespace import of a package and the
// members the source reads from it, so the spec can ask real Node for them. Pure, so tested.
import ts from 'typescript';

export interface NamespaceImport {
  /** The local name, e.g. `Papa` in `import * as Papa from 'papaparse'`. */
  local: string;
  /** The package specifier, e.g. `papaparse` or `@sentry/nestjs`. */
  specifier: string;
  /** Every `local.member` the file reads at run time, sorted and unique. */
  members: string[];
}

/** `./x` and `../x` are the backend's own modules; everything else is a package or a builtin. */
const isPackage = (specifier: string): boolean => !specifier.startsWith('.');

/**
 * The value-level namespace imports of packages in one source file, with the members it reads.
 * `import type * as X` is erased by tsc and skipped. Type positions (`X.Type` in an annotation)
 * are qualified names, not property accesses, so only run-time reads are collected.
 */
export function namespaceImports(fileName: string, source: string): NamespaceImport[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found = new Map<string, { specifier: string; members: Set<string> }>();

  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const clause = statement.importClause;
    const bindings = clause?.namedBindings;
    if (!clause || clause.isTypeOnly || !bindings || !ts.isNamespaceImport(bindings)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (isPackage(specifier)) found.set(bindings.name.text, { specifier, members: new Set() });
  }

  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression)) {
      found.get(node.expression.text)?.members.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  return [...found].map(([local, { specifier, members }]) => ({
    local,
    specifier,
    members: [...members].sort(),
  }));
}

/**
 * One message per member a file reads from a namespace that Node's own namespace for the package
 * does not export. `exportsBySpecifier` holds the export names real Node reported.
 */
export function findMissingNamespaceMembers(
  file: string,
  imports: NamespaceImport[],
  exportsBySpecifier: Record<string, string[]>,
): string[] {
  const problems: string[] = [];
  for (const { local, specifier, members } of imports) {
    const exported = new Set(exportsBySpecifier[specifier] ?? []);
    for (const member of members.filter((name) => !exported.has(name))) {
      problems.push(
        `${file}: \`${local}.${member}\` is undefined under native ESM — '${specifier}' does not ` +
          `export "${member}" to a namespace import; use its default import (#63)`,
      );
    }
  }
  return problems;
}
