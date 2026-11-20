// SPEC-010 BR-010-25, BR-010-26 (DL-010-07): a lawyer's validation is recorded ONLY by the operator
// script `npm run legal:record-validation`; nothing the API serves can write one. A route that wrote a
// validation would let anyone who reached it open the legal gate. This is the first line, at review
// time; the second is the integration spec that finds no write route at runtime.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', '..', 'src');
const all = (readdirSync(SRC, { recursive: true }) as string[])
  .map((file) => file.split('\\').join('/'))
  .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
  .map((file) => ({ file, text: readFileSync(join(SRC, file), 'utf8') }));

const WRITE_VERBS = /@(Post|Put|Patch|Delete)\s*\(/;

describe('SPEC-010 BR-010-25: no HTTP route records a legal validation', () => {
  it('finds the whole of src/', () => {
    expect(all.length).toBeGreaterThan(200);
  });

  it('no controller of privacy/legal-validation/ has a write route', () => {
    const controllers = all.filter(
      ({ file, text }) =>
        file.startsWith('privacy/legal-validation/') && /@Controller\(/.test(text),
    );
    expect(controllers.map(({ file }) => file)).toEqual([
      'privacy/legal-validation/launch-checklist.controller.ts',
    ]);
    expect(controllers.filter(({ text }) => WRITE_VERBS.test(text))).toEqual([]);
  });

  it('the validations repository is used by the service (reads) and the script (the insert) only', () => {
    const users = all
      .filter(({ text }) => /\bLegalValidationsRepository\b/.test(text))
      .map(({ file }) => file)
      .sort();
    expect(users).toEqual([
      'privacy/legal-validation/legal-validation.module.ts',
      'privacy/legal-validation/legal-validation.service.ts',
      'privacy/legal-validation/legal-validations.repository.ts',
      'privacy/legal-validation/record/record-validation.command.ts',
      'privacy/legal-validation/record/record-validation.module.ts',
    ]);
  });

  it('only the script calls the repository insert, and no controller imports the script', () => {
    const inserting = all
      .filter(({ file, text }) => file.startsWith('privacy/') && /validations\.insert\(/.test(text))
      .map(({ file }) => file);
    expect(inserting).toEqual(['privacy/legal-validation/record/record-validation.command.ts']);
    const importers = all.filter(
      ({ text }) => /@Controller\(/.test(text) && /legal-validation\/record\//.test(text),
    );
    expect(importers).toEqual([]);
  });

  it('the script is a package.json script, run from the compiled output', () => {
    const pkg = JSON.parse(readFileSync(join(SRC, '..', 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['legal:record-validation']).toBe(
      'node dist/privacy/legal-validation/record/run.js',
    );
  });
});
