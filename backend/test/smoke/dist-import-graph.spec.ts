// #63: the compiled output runs as native ESM. tsc and Vitest both resolve and interop modules
// their own way, so an import that only breaks under Node — a named import a CommonJS package
// does not expose, a relative specifier without `.js`, a directory import, a JSON import without
// its attribute — passes every other suite and fails in production. This spec loads every module
// of dist/ in a plain `node` child process, the way the image runs it, with the fake test
// environment (TS-27) so that AppModule's ConfigModule.forRoot validates instead of throwing.
// Loading a module evaluates it and its imports; it connects nowhere (Mongoose connects only when
// Nest bootstraps, and nothing here bootstraps Nest).
//
// `npm run test:smoke` builds first; the CI `backend-build` job runs it. Namespace imports, which
// link even when the member is missing, are audited by test/structural/esm-interop.spec.ts.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'child_process';
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { TEST_ENV } from '../support/test-env.js';

const BACKEND = join(import.meta.dirname, '..', '..');
const DIST = join(BACKEND, 'dist');

// The process entry points start the app or the migrations as soon as they load. Everything they
// import is another dist module, which this spec loads.
const ENTRY_POINTS = new Set(['main.js', 'migrations/run.js']);

function distModules(): string[] {
  return (readdirSync(DIST, { recursive: true }) as string[])
    .map((file) => file.split('\\').join('/'))
    .filter((file) => file.endsWith('.js') && !ENTRY_POINTS.has(file))
    .sort();
}

interface LoadFailure {
  file: string;
  error: string;
}

/** Imports each file in one plain Node process; returns the ones that failed, with the error. */
function loadInNode(files: string[]): LoadFailure[] {
  const script = [
    "import { join } from 'node:path';",
    "import { pathToFileURL } from 'node:url';",
    // As main.ts does before AppModule: decorators read and write Reflect metadata on load.
    "await import('reflect-metadata');",
    'const failures = [];',
    'for (const file of JSON.parse(process.env.DIST_FILES)) {',
    '  try { await import(pathToFileURL(join(process.env.DIST_DIR, file)).href); }',
    '  catch (error) { failures.push({ file, error: String(error) }); }',
    '}',
    'process.stdout.write(JSON.stringify(failures));',
    // Some modules start timers or handles on load (pino transports, caches); exit explicitly.
    'process.exit(0);',
  ].join('\n');
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: BACKEND,
    env: {
      PATH: process.env.PATH,
      ...TEST_ENV,
      DIST_DIR: DIST,
      DIST_FILES: JSON.stringify(files),
    },
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(output) as LoadFailure[];
}

describe('#63: the compiled dist/ import graph loads under native ESM', () => {
  it('has a build to load (`npm run test:smoke` runs `npm run build` first)', () => {
    expect(existsSync(join(DIST, 'app.module.js'))).toBe(true);
  });

  it('loads AppModule, MigrationsModule and every other compiled module without an error', () => {
    const files = distModules();
    expect(files).toEqual(
      expect.arrayContaining(['app.module.js', 'migrations/migrations.module.js', 'instrument.js']),
    );
    expect(loadInNode(files)).toEqual([]);
  });

  it('reports a module that Node cannot link', () => {
    // The class of bug this spec exists for: a named import that a CommonJS package does not
    // expose to ESM links under Vitest and fails under Node.
    const failures = loadInNode(['../test/smoke/fixtures/broken-named-import.js']);
    expect(failures).toEqual([
      {
        file: '../test/smoke/fixtures/broken-named-import.js',
        error: expect.stringContaining("Named export 'parse' not found"),
      },
    ]);
  });
});
