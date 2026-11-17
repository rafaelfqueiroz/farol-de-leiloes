// SPEC-002 TS-14 / AR-16: the run-time half of the isolation gate must fail when an
// isolationSpecFor(...) block contains a test on paper and runs none. Static parsing cannot see
// that, so this spec runs a CHILD `vitest run` over the fixtures in
// test/isolation/support/__fixtures__/ (a minimal config, the real reporter, no Docker) and reads
// its exit code and output, exactly what `npm run test:isolation` sees.
import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  ISOLATED_MODEL,
  REQUIRED_MODELS,
  uncoveredModels,
} from '../isolation/support/executed-isolation.js';
import { scanIsolationSpec } from '../isolation/support/isolation-coverage.js';

const FIXTURES = join(import.meta.dirname, '../isolation/support/__fixtures__');
const VITEST = join(import.meta.dirname, '../../node_modules/vitest/vitest.mjs');

function runFixtures(files: string[], required: string[]) {
  const run = spawnSync(
    process.execPath,
    [VITEST, 'run', '--config', join(FIXTURES, 'vitest.fixture.config.mts'), ...files],
    {
      cwd: FIXTURES,
      encoding: 'utf8',
      env: { ...process.env, FIXTURE_REQUIRED: required.join(','), FORCE_COLOR: '0' },
      timeout: 60_000,
    },
  );
  return { code: run.status, output: `${run.stdout}\n${run.stderr}` };
}

describe('TS-14: the post-run isolation check counts only tests that ran and passed', () => {
  it('passes a model whose isolation test ran and passed', () => {
    const run = runFixtures(['enumeration.fixture.ts', 'positive.fixture.ts'], ['PositiveEntity']);

    expect(run.output).not.toContain('TS-14 isolation gate');
    expect(run.code).toBe(0);
  });

  it('counts a nested call for the outer and the inner model', () => {
    const run = runFixtures(
      ['enumeration.fixture.ts', 'nested.fixture.ts'],
      ['InnerEntity', 'OuterEntity'],
    );

    expect(run.output).not.toContain('TS-14 isolation gate');
    expect(run.code).toBe(0);
  });

  it.each([
    ['(a) a loop over an empty scenarios array', 'empty-loop.fixture.ts', 'EmptyLoopEntity'],
    ['(b) an environment-conditional registration', 'conditional.fixture.ts', 'ConditionalEntity'],
    ['(c) a helper that is never called', 'uncalled-helper.fixture.ts', 'UncalledHelperEntity'],
    ['a test that runs and fails', 'failing.fixture.ts', 'FailingEntity'],
  ])('fails the run for %s, naming the model', (_case, file, model) => {
    const run = runFixtures(['enumeration.fixture.ts', 'positive.fixture.ts', file], [model]);

    expect(run.code).not.toBe(0);
    expect(run.output).toContain('TS-14 isolation gate');
    expect(run.output).toContain(`- ${model}`);
  });

  it('names every uncovered model, and only those', () => {
    const run = runFixtures(
      [
        'enumeration.fixture.ts',
        'positive.fixture.ts',
        'empty-loop.fixture.ts',
        'conditional.fixture.ts',
      ],
      ['PositiveEntity', 'EmptyLoopEntity', 'ConditionalEntity'],
    );

    expect(run.code).not.toBe(0);
    expect(run.output).toContain('- ConditionalEntity');
    expect(run.output).toContain('- EmptyLoopEntity');
    expect(run.output).not.toContain('- PositiveEntity');
  });

  it('does not fail a partial run that did not include the enumeration spec', () => {
    const run = runFixtures(['positive.fixture.ts'], ['NotRunHere']);

    expect(run.output).not.toContain('TS-14 isolation gate');
    expect(run.code).toBe(0);
  });

  it('the static parser alone cannot tell: all three cases look covered to it', () => {
    for (const file of ['empty-loop', 'conditional', 'uncalled-helper']) {
      const source = readFixture(`${file}.fixture.ts`);
      expect(scanIsolationSpec(source).problems).toEqual([]);
      expect(scanIsolationSpec(source).models).toHaveLength(1);
    }
  });
});

describe('uncoveredModels', () => {
  const passed = (meta: Record<string, unknown>) => ({ meta, state: 'passed' });

  it('is not applicable without a passed enumeration test', () => {
    expect(uncoveredModels([passed({ [ISOLATED_MODEL]: ['A'] })])).toBeUndefined();
    expect(
      uncoveredModels([{ meta: { [REQUIRED_MODELS]: ['A'] }, state: 'failed' }]),
    ).toBeUndefined();
  });

  it('ignores covering tests that did not pass', () => {
    expect(
      uncoveredModels([
        passed({ [REQUIRED_MODELS]: ['B', 'A'] }),
        { meta: { [ISOLATED_MODEL]: ['A'] }, state: 'failed' },
        { meta: { [ISOLATED_MODEL]: ['B'] }, state: 'skipped' },
      ]),
    ).toEqual(['A', 'B']);
  });
});

function readFixture(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8');
}
