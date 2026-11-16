// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// SC-02: the session token lives only in an httpOnly cookie that the BFF sets and reads. It is
// never in localStorage or sessionStorage, and no browser code builds an Authorization header.
// This scan fails when someone puts it back. localStorage stays legitimate for non-secret
// preferences (the colour scheme, the pinned rail: DS-07, DESIGN §6).
const root = join(import.meta.dirname, '../..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const files = ['app', 'lib'].flatMap((dir) => sourceFiles(join(root, dir)));
const rel = (path: string) => relative(root, path);

/** Source text with comments blanked, so a comment that explains the rule is not a violation. */
const code = (path: string) =>
  readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const SECRET_KEY = /token|jwt|session|auth|credential/i;

/** Each `localStorage`/`sessionStorage` access whose key (or whole statement) looks like a credential. */
function storedSecrets(source: string): string[] {
  const hits: string[] = [];
  for (const match of source.matchAll(
    /(?:local|session)Storage\s*(?:\.\s*(?:getItem|setItem|removeItem)\s*\(([^)]*)\)|\[([^\]]*)\])/g,
  )) {
    const key = match[1] ?? match[2] ?? '';
    if (SECRET_KEY.test(key)) hits.push(match[0]);
  }
  return hits;
}

describe('SC-02 the session token is never kept by browser code', () => {
  it('scans the application source', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('uses neither localStorage nor sessionStorage for a token, session or credential', () => {
    const offenders = files.flatMap((path) =>
      storedSecrets(code(path)).map((hit) => `${rel(path)}: ${hit}`),
    );
    expect(offenders, 'SC-02: the token lives only in the httpOnly cookie').toEqual([]);
  });

  it('builds no Authorization header outside the BFF (app/api, lib/backend.ts)', () => {
    const offenders = files
      .filter((path) => !rel(path).startsWith('app/api/') && rel(path) !== 'lib/backend.ts')
      .filter((path) => /authorization/i.test(code(path)))
      .map(rel);
    expect(offenders, 'SC-02: only the BFF turns the cookie into a Bearer header').toEqual([]);
  });

  it('forwards no browser Authorization header from a route handler', () => {
    const offenders = files
      .filter((path) => rel(path).startsWith('app/api/') || rel(path) === 'lib/backend.ts')
      .filter((path) =>
        /headers\s*\.\s*get\(\s*['"`]authorization['"`]|headers\s*\[\s*['"`]authorization['"`]|authorizationOf/i.test(
          code(path),
        ),
      )
      .map(rel);
    expect(offenders, 'SC-02: the BFF reads the cookie, never the request Authorization').toEqual(
      [],
    );
  });

  it('reads no document.cookie (the session cookie is httpOnly, and nothing else is parsed by hand)', () => {
    const offenders = files.filter((path) => /document\s*\.\s*cookie/.test(code(path))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('the scan itself', () => {
  it('flags a token kept in either storage, by any quoting', () => {
    expect(storedSecrets(`localStorage.getItem('token')`)).toHaveLength(1);
    expect(storedSecrets(`window.sessionStorage.setItem("accessToken", t)`)).toHaveLength(1);
    expect(storedSecrets('localStorage.removeItem(`jwt`)')).toHaveLength(1);
    expect(storedSecrets(`localStorage[SESSION_KEY]`)).toHaveLength(1);
  });

  it('leaves non-secret preferences alone', () => {
    expect(storedSecrets(`window.localStorage.getItem(RAIL_PINNED_STORAGE_KEY)`)).toEqual([]);
    expect(storedSecrets(`localStorage.setItem('mui-mode', 'dark')`)).toEqual([]);
  });
});
