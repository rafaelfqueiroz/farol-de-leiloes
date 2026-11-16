// SPEC-003 BR-003-06: the budgets are stated at p95 over 20 runs; the summary of a run reports
// the same percentile.
import { describe, expect, it } from 'vitest';
import { percentile, summarizeReports, summaryTable } from './stats.mjs';

const twenty = Array.from({ length: 20 }, (_, i) => (i + 1) * 100); // 100 .. 2000

describe('percentile (nearest rank)', () => {
  it('takes the 19th of 20 sorted values as p95', () => {
    expect(percentile([...twenty].reverse(), 95)).toBe(1900);
    expect(percentile(twenty, 50)).toBe(1000);
    expect(percentile(twenty, 100)).toBe(2000);
  });

  it('handles one value and refuses none', () => {
    expect(percentile([7], 95)).toBe(7);
    expect(() => percentile([], 95)).toThrow('no values');
    expect(() => percentile([1], 0)).toThrow('p must');
  });
});

const run = (url: string, lcp: number, tti: number) => ({
  requestedUrl: url,
  audits: {
    'largest-contentful-paint': { numericValue: lcp },
    interactive: { numericValue: tti },
    'total-blocking-time': { numericValue: 50 },
  },
});

describe('summarizeReports', () => {
  const url = 'http://localhost:38101/search?state=SP&pageSize=10';
  const other = 'http://localhost:38101/auction/1';
  const reports = [...twenty.map((lcp) => run(url, lcp, lcp + 100)), run(other, 900, 1100)];

  it('groups the runs by URL and reports p50, p95 and the worst run', () => {
    const [search, property] = summarizeReports(reports);
    expect(search?.runs).toBe(20);
    expect(search?.metrics['largest-contentful-paint']).toEqual({
      p50: 1000,
      p95: 1900,
      max: 2000,
    });
    expect(search?.metrics.interactive?.p95).toBe(2000);
    expect(property?.runs).toBe(1);
  });

  it('leaves a metric no report carried as NaN', () => {
    const [page] = summarizeReports([run(other, 1, 1)]);
    expect(page?.metrics['first-contentful-paint']?.p95).toBeNaN();
  });

  it('renders a table with the budget of each page', () => {
    const table = summaryTable(summarizeReports(reports), (u) => (u === url ? 2000 : undefined));
    expect(table).toContain('| /search?state=SP&pageSize=10 | 20 | 2000 ms | 1900 ms (2000 ms) |');
    expect(table).toContain('| /auction/1 | 1 | none |');
    expect(table).toContain('n/a');
  });
});
