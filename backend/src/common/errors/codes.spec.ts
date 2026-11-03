// AR-37/AR-38: the catalogue is the contract with the frontend (AR-39). Codes are UPPER_SNAKE,
// unique, each has a status, and the file stays the plain list the frontend test parses as text.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ERROR_CODES } from './codes';
import { ERROR_STATUS } from './error-status';

describe('ERROR_CODES', () => {
  it('are UPPER_SNAKE_CASE', () => {
    for (const code of ERROR_CODES) expect(code).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
  });

  it('are unique', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length);
  });

  it('each have an HTTP status, and the status table has no code outside the catalogue', () => {
    expect(Object.keys(ERROR_STATUS).sort()).toEqual([...ERROR_CODES].sort());
    for (const code of ERROR_CODES) expect(ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
  });

  it('read back from the file text exactly as the frontend catalogue test reads them', () => {
    const text = readFileSync(join(__dirname, 'codes.ts'), 'utf8');
    expect(text).not.toMatch(/^import /m);
    const literals = [...text.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((match) => match[1]);
    expect(literals).toEqual([...ERROR_CODES]);
  });
});
