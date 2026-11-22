// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// SPEC-010 BR-010-02, BR-010-04, SC-20: two properties of the legal pages that a later change could
// break without any single test noticing.
const root = resolve(import.meta.dirname, '../..');
const app = join(root, 'app');
const page = (...parts: string[]) => existsSync(join(app, ...parts, 'page.tsx'));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('where the legal pages live (DESIGN.md §6)', () => {
  it('has the two documents in the public (shell) group: a visitor reads them with no login', () => {
    for (const route of ['termos', 'privacidade']) {
      expect(page('(shell)', route), `/${route} is public`).toBe(true);
      expect(page('(shell)', '(authenticated)', route), `/${route} is not behind the guard`).toBe(
        false,
      );
    }
  });

  it('keeps only the version in force: no page for an older version (BR-010-04)', () => {
    for (const route of ['termos', 'privacidade']) {
      const dir = join(app, '(shell)', route);
      const nested = readdirSync(dir).filter((name) => statSync(join(dir, name)).isDirectory());
      expect(nested, `/${route}/[version] must not exist`).toEqual([]);
    }
  });

  it('has the rights page behind the guard and the closed-account screen outside the shell', () => {
    expect(page('(shell)', '(authenticated)', 'profile', 'privacidade')).toBe(true);
    expect(page('(shell)', 'profile', 'privacidade')).toBe(false);
    expect(page('conta-encerrada')).toBe(true);
  });
});

// The one legitimate `dangerouslySetInnerHTML` of the app is the JSON-LD script of the property page
// (JSON.stringify of our own data, never text a person or the API wrote). Everything that touches the
// legal text, the privacy page and the consent screens is held to none at all.
describe('SC-20: the legal text is never rendered as HTML', () => {
  const files = [
    ...sourceFiles(join(app, 'components', 'legal')),
    ...sourceFiles(join(app, 'components', 'privacy')),
    ...sourceFiles(join(app, 'components', 'account')),
    ...sourceFiles(join(app, '(shell)', 'termos')),
    ...sourceFiles(join(app, '(shell)', 'privacidade')),
    join(app, 'components', 'patterns', 'LegalDocument.tsx'),
    join(root, 'lib', 'legal-markdown.ts'),
    join(root, 'lib', 'legal.ts'),
    join(root, 'lib', 'legal-server.ts'),
  ];

  it('scans the files that read or render the documents', () => {
    expect(files.length).toBeGreaterThan(15);
  });

  it('has no dangerouslySetInnerHTML and writes no innerHTML or outerHTML: the text is React elements', () => {
    const offenders = files
      .filter((path) =>
        /dangerouslySetInnerHTML|\.(inner|outer)HTML\s*=|insertAdjacentHTML/.test(
          readFileSync(path, 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1'),
        ),
      )
      .map((path) => relative(root, path));
    expect(offenders).toEqual([]);
  });
});
