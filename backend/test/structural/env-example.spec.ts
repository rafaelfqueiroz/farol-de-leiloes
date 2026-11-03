// AR-44: backend/.env.example lists exactly the variables of the config schema (AR-41), each with
// a comment, so a variable added to the schema without documenting it fails here.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { ENV_KEYS } from '../../src/config/env.schema';
import { validateEnv } from '../../src/config/env';
import {
  exampleKeys,
  exampleValues,
  findEnvExampleProblems,
  findFilledInSecrets,
} from './env-example-check';

describe('AR-44: backend/.env.example', () => {
  const example = readFileSync(join(__dirname, '..', '..', '.env.example'), 'utf8');

  it('lists every schema variable, nothing else, each with a comment', () => {
    expect(findEnvExampleProblems(example, ENV_KEYS)).toEqual([]);
  });

  it('holds placeholders, never a filled-in secret', () => {
    // SC-16: secret-looking keys are empty or obviously fake (fake-, replace-, your-, example).
    expect(findFilledInSecrets(example)).toEqual([]);
  });

  it('boots as is: copying it to .env passes the boot-time validation', () => {
    // AR-41/AR-44: the file is a working starting point, so `cp .env.example .env` always boots.
    expect(() => validateEnv(exampleValues(example))).not.toThrow();
  });
});

describe('env example checks', () => {
  const schema = ['A_KEY', 'B_KEY'];

  it('accepts a file with every key, each under a comment', () => {
    const example = '# a\nA_KEY=1\n\n# b\nB_KEY=\n';
    expect(exampleKeys(example)).toEqual(['A_KEY', 'B_KEY']);
    expect(findEnvExampleProblems(example, schema)).toEqual([]);
  });

  it('flags a realistic-looking secret but accepts obvious placeholders', () => {
    const fine =
      'API_KEY=\nJWT_SECRET=replace-with-x\nSMTP_PASS=your-pass\nOPENAI_API_KEY=fake-OPENAI_API_KEY\n';
    expect(findFilledInSecrets(fine)).toEqual([]);
    const real = 'STRIPE_SECRET_KEY=sk_live_51Hh8dKq9Zx7Yw2LmN4pQ\nPORT=3000\n';
    expect(findFilledInSecrets(real)).toEqual([
      'STRIPE_SECRET_KEY: holds a value that does not look like a placeholder',
    ]);
  });

  it('reports a missing key, a stale key, a duplicate and an uncommented key', () => {
    const example = '# a\nA_KEY=1\nA_KEY=2\n# old\nIMPORT_RUN_MODE=AUTO\n';
    expect(findEnvExampleProblems(example, schema)).toEqual([
      'B_KEY: read by the schema, missing from .env.example',
      'IMPORT_RUN_MODE: in .env.example, not read by the schema',
      'A_KEY: listed more than once',
      'A_KEY: needs a comment line directly above it',
    ]);
  });
});
