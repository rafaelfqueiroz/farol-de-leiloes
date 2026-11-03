// @vitest-environment node
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRONTEND_ERROR_CODES } from '@/lib/api-error';
import messages from '@/messages/pt-BR.json';

// AR-39: every code the API can answer with has a pt-BR message in `errors.<CODE>`. The backend's
// catalogue (AR-37) is a plain list of single-quoted literals so this test can read it as text; a
// code added there without a message here fails the build.
const CODES_FILE = resolve(import.meta.dirname, '../../../backend/src/common/errors/codes.ts');
// a floor, not the count: it only guards against the extraction silently finding nothing
const MIN_BACKEND_CODES = 30;

function backendCodes(): string[] {
  const source = readFileSync(CODES_FILE, 'utf8');
  const list = /ERROR_CODES\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(source);
  if (!list?.[1]) throw new Error('ERROR_CODES not found in backend/src/common/errors/codes.ts');
  // drop line comments first so a quoted word in a comment is not read as a code
  const body = list[1].replace(/\/\/.*$/gm, '');
  return [...body.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((match) => match[1] as string);
}

const catalogue = messages.errors as Record<string, string>;

describe('error catalogue (AR-39)', () => {
  const codes = backendCodes();

  it('reads the backend catalogue', () => {
    expect(codes.length).toBeGreaterThanOrEqual(MIN_BACKEND_CODES);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('has an errors.<CODE> message for every backend code', () => {
    const missing = codes.filter((code) => !catalogue[code]);
    expect(missing, `codes without an errors.<CODE> entry in messages/pt-BR.json`).toEqual([]);
  });

  it('has a message for every frontend-only code', () => {
    const missing = FRONTEND_ERROR_CODES.filter((code) => !catalogue[code]);
    expect(missing).toEqual([]);
  });

  it('has no entry for a code that exists nowhere', () => {
    const known = new Set<string>([...codes, ...FRONTEND_ERROR_CODES]);
    const orphans = Object.keys(catalogue).filter((key) => !known.has(key));
    expect(orphans, 'errors.* keys that are not backend codes or frontend-only codes').toEqual([]);
  });

  it('lists exactly UNKNOWN and BACKEND_UNAVAILABLE as frontend-only', () => {
    expect([...FRONTEND_ERROR_CODES].sort()).toEqual(['BACKEND_UNAVAILABLE', 'UNKNOWN']);
  });
});
