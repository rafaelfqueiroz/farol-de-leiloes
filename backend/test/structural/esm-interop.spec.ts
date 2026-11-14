// #63: every namespace import of a package in production code (`import * as X from 'pkg'`) reads
// only members that real Node's ESM namespace for that package exports. Vitest's own interop
// fills a CommonJS namespace in, so a spec can never see this bug; the export names come from a
// plain `node` child process instead, resolving packages from backend/ exactly as dist/ does.
// Named imports need no audit here: Node refuses to link a missing one, which the dist smoke test
// (test/smoke/, `npm run test:smoke`) catches by loading the compiled import graph.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { findMissingNamespaceMembers, namespaceImports } from './esm-interop-check.js';

const BACKEND = join(import.meta.dirname, '..', '..');
const SRC = join(BACKEND, 'src');

/** The export names of each package's ESM namespace, as plain Node reports them. */
function nativeExportNames(specifiers: string[]): Record<string, string[]> {
  const script = [
    'const names = {};',
    'for (const specifier of JSON.parse(process.env.SPECIFIERS)) {',
    '  names[specifier] = Object.keys(await import(specifier));',
    '}',
    'process.stdout.write(JSON.stringify(names));',
  ].join('\n');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: BACKEND,
    env: { PATH: process.env.PATH, SPECIFIERS: JSON.stringify(specifiers) },
    encoding: 'utf8',
  });
  return JSON.parse(output) as Record<string, string[]>;
}

function productionFiles(): string[] {
  return (readdirSync(SRC, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .map((file) => file.split('\\').join('/'))
    .sort();
}

describe('#63: namespace imports of packages work under native ESM', () => {
  const imports = productionFiles().map((file) => ({
    file,
    found: namespaceImports(file, readFileSync(join(SRC, file), 'utf8')),
  }));
  const specifiers = [...new Set(imports.flatMap(({ found }) => found.map((i) => i.specifier)))];

  it('finds the namespace imports the audit covers', () => {
    // A new one is fine; this list only proves the scan sees them (bcrypt and nodemailer are
    // CommonJS whose exports Node detects; cheerio and @sentry/nestjs ship ESM).
    expect(specifiers).toEqual(
      expect.arrayContaining(['bcrypt', 'nodemailer', 'cheerio', '@sentry/nestjs']),
    );
  });

  it('reads only members that Node exports to the namespace', () => {
    const exportsBySpecifier = nativeExportNames(specifiers);
    const problems = imports.flatMap(({ file, found }) =>
      findMissingNamespaceMembers(`src/${file}`, found, exportsBySpecifier),
    );
    expect(problems).toEqual([]);
  });

  it('catches papaparse, whose UMD bundle Node exposes only as `default`', () => {
    // The production bug the #62 trial found: `import * as Papa` built, passed tsc and Vitest, and
    // threw `Papa.parse is not a function` from dist/.
    const source = "import * as Papa from 'papaparse';\nPapa.parse<string[]>(csv);";
    const problems = findMissingNamespaceMembers(
      'parser.ts',
      namespaceImports('parser.ts', source),
      nativeExportNames(['papaparse']),
    );
    expect(problems).toEqual([
      expect.stringContaining('`Papa.parse` is undefined under native ESM'),
    ]);
  });
});

describe('namespaceImports', () => {
  it('collects the run-time members read from each package namespace', () => {
    const source = [
      "import * as bcrypt from 'bcrypt';",
      "import * as nodemailer from 'nodemailer';",
      'let t: nodemailer.Transporter;',
      'await bcrypt.hash(x, 10); await bcrypt.compare(a, b); bcrypt.hash(y, 10);',
      't = nodemailer.createTransport({});',
    ].join('\n');
    expect(namespaceImports('a.ts', source)).toEqual([
      { local: 'bcrypt', specifier: 'bcrypt', members: ['compare', 'hash'] },
      // `nodemailer.Transporter` is a type position, erased by tsc: not a run-time read.
      { local: 'nodemailer', specifier: 'nodemailer', members: ['createTransport'] },
    ]);
  });

  it('skips relative modules, type-only, default and named imports', () => {
    const source = [
      "import * as local from './local.js';",
      "import type * as T from 'stripe';",
      "import Papa from 'papaparse';",
      "import { load } from 'cheerio';",
      'local.x(); T.y; Papa.parse(s); load(h);',
    ].join('\n');
    expect(namespaceImports('a.ts', source)).toEqual([]);
  });
});

describe('findMissingNamespaceMembers', () => {
  it('names each member the namespace lacks', () => {
    const imports = [{ local: 'Papa', specifier: 'papaparse', members: ['parse', 'unparse'] }];
    expect(
      findMissingNamespaceMembers('src/p.ts', imports, { papaparse: ['default', 'unparse'] }),
    ).toEqual([expect.stringContaining('src/p.ts: `Papa.parse` is undefined')]);
  });

  it('passes when every member is exported', () => {
    const imports = [{ local: 'bcrypt', specifier: 'bcrypt', members: ['hash'] }];
    expect(findMissingNamespaceMembers('src/u.ts', imports, { bcrypt: ['hash'] })).toEqual([]);
  });
});

describe('#63 / AR-47: the API process runs as native ESM with Sentry loaded first', () => {
  const pkg = JSON.parse(readFileSync(join(BACKEND, 'package.json'), 'utf8')) as {
    type?: string;
    scripts: Record<string, string>;
  };
  const dockerfile = readFileSync(join(BACKEND, 'Dockerfile'), 'utf8');
  // Under ESM, `import './instrument.js'` at the top of main.ts runs too late for Sentry's module
  // hooks: every static import is loaded before any module body runs. Node must preload it.
  const PRELOAD = '--import ./dist/instrument.js dist/main.js';

  it('declares "type": "module"', () => {
    expect(pkg.type).toBe('module');
  });

  it.each(['start', 'start:dev', 'start:debug'])(
    '`npm run %s` preloads dist/instrument.js',
    (name) => {
      expect(pkg.scripts[name]).toContain(PRELOAD);
    },
  );

  it('the image CMD preloads dist/instrument.js', () => {
    expect(dockerfile).toMatch(
      /^CMD \["node", "--import", "\.\/dist\/instrument\.js", "dist\/main\.js"\]$/m,
    );
  });

  it('the image keeps package.json beside dist/, where its "type" applies', () => {
    expect(dockerfile).toMatch(/^COPY --from=build \/app\/package\.json \.\/$/m);
  });
});
