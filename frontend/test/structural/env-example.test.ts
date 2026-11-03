// AR-44: every variable lib/env.ts reads is listed in .env.example with a comment, and nothing
// else is. Adding a variable to the schema without documenting it fails here, not in review.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { publicEnvSchema, serverEnvSchema } from '@/lib/env';

const lines = readFileSync(resolve(import.meta.dirname, '../../.env.example'), 'utf8').split('\n');

const entries = lines.flatMap((line, index) => {
  const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
  return match ? [{ key: match[1], index }] : [];
});

describe('.env.example', () => {
  it('lists exactly the variables lib/env.ts reads', () => {
    const schemaKeys = [
      ...Object.keys(publicEnvSchema.shape),
      ...Object.keys(serverEnvSchema.shape),
    ].sort();
    expect(entries.map((e) => e.key).sort()).toEqual(schemaKeys);
  });

  it('puts a comment on the line above every variable', () => {
    const uncommented = entries
      .filter(({ index }) => !lines[index - 1]?.startsWith('#'))
      .map((e) => e.key);
    expect(uncommented).toEqual([]);
  });

  it('lists no variable twice', () => {
    const keys = entries.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
