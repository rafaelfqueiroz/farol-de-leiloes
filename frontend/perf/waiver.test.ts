// SPEC-003 BR-003-10: a missed budget blocks the release unless the release notes record a waiver
// with its reason. The format is one line, `Performance waiver: <reason>`.
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { findWaiver } from './waiver.mjs';

describe('BR-003-10: findWaiver', () => {
  it('returns the reason of a waiver line', () => {
    const notes =
      '## v1.2.0\n\n- Faster search\n\nPerformance waiver: search is 2.4 s while #150 lands\n';
    expect(findWaiver(notes)).toBe('search is 2.4 s while #150 lands');
  });

  it('finds no waiver when the notes do not mention one', () => {
    expect(findWaiver('## v1.2.0\n\n- Faster search\n')).toBeNull();
    expect(findWaiver('')).toBeNull();
    expect(findWaiver(null)).toBeNull();
    expect(findWaiver(undefined)).toBeNull();
  });

  it('does not take a waiver without a reason', () => {
    expect(findWaiver('Performance waiver:')).toBeNull();
    expect(findWaiver('Performance waiver:    \n- other')).toBeNull();
    expect(findWaiver('**Performance waiver:**')).toBeNull();
  });

  it('does not take the template’s placeholder or a non-reason as a reason', () => {
    expect(findWaiver('Performance waiver: <reason>')).toBeNull();
    expect(findWaiver('Performance waiver: TBD')).toBeNull();
    expect(findWaiver('Performance waiver: -')).toBeNull();
  });

  it('accepts a list item, bold, any case and Windows line endings', () => {
    expect(findWaiver('- Performance waiver: slow disk on the runner')).toBe(
      'slow disk on the runner',
    );
    expect(findWaiver('**Performance waiver:** known regression')).toBe('known regression');
    expect(findWaiver('PERFORMANCE WAIVER : agreed with the owner')).toBe('agreed with the owner');
    expect(findWaiver('notes\r\nPerformance waiver: because\r\nmore')).toBe('because');
  });

  it('does not take the words in the middle of a sentence', () => {
    expect(findWaiver('We have no Performance waiver: this time')).toBeNull();
  });

  it('skips an empty waiver line and takes a later valid one', () => {
    expect(findWaiver('Performance waiver:\nPerformance waiver: second try')).toBe('second try');
  });
});

describe('check-waiver.mjs, the command the release gate runs', () => {
  const script = join(import.meta.dirname, 'check-waiver.mjs');
  const run = (notes: string) =>
    spawnSync(process.execPath, [script], { input: notes, encoding: 'utf8' });

  it('exits 0 and prints the reason when the notes carry a waiver', () => {
    const result = run('Performance waiver: known\n');
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('known\n');
  });

  it('exits 1 when there is no waiver, or no reason', () => {
    expect(run('nothing here').status).toBe(1);
    expect(run('Performance waiver:   ').status).toBe(1);
  });
});
