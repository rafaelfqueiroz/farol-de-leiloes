// AR-48: what GET /api/health reports. Critical-module rules apply (100% branch, TS-24); every
// expectation is computed by hand in the comments (TS-04).
import { describe, expect, it } from 'vitest';
import {
  assessLastImport,
  healthReport,
  IMPORT_STALE_AFTER_HOURS,
  type ImportReport,
} from './health-report.js';

const NOW = new Date('2026-01-15T12:00:00.000Z');
const ok: ImportReport = {
  status: 'SUCCESS',
  finishedAt: '2026-01-15T06:00:00.000Z',
  ageHours: 6,
  stale: false,
};

describe('assessLastImport', () => {
  it('reports a run that never happened as NEVER, and stale', () => {
    expect(assessLastImport(null, NOW)).toEqual({
      status: 'NEVER',
      finishedAt: null,
      ageHours: null,
      stale: true,
    });
  });

  it('reports the outcome, finish time and age of the last run', () => {
    // 2026-01-15T03:00Z → 12:00Z = 9 h.
    expect(
      assessLastImport(
        { status: 'SUCCESS', finishedAt: new Date('2026-01-15T03:00:00.000Z') },
        NOW,
      ),
    ).toEqual({
      status: 'SUCCESS',
      finishedAt: '2026-01-15T03:00:00.000Z',
      ageHours: 9,
      stale: false,
    });
  });

  it('rounds the age to two decimals', () => {
    // 11:39:00Z → 12:00Z = 21 min = 0.35 h exactly; 11:40:00Z → 20 min = 0.3333… → 0.33.
    expect(
      assessLastImport({ status: 'FAILED', finishedAt: new Date('2026-01-15T11:39:00.000Z') }, NOW)
        .ageHours,
    ).toBe(0.35);
    expect(
      assessLastImport({ status: 'FAILED', finishedAt: new Date('2026-01-15T11:40:00.000Z') }, NOW)
        .ageHours,
    ).toBe(0.33);
  });

  it('is stale only past 32 h: a record every day by the cutoff (30 h apart at most) plus 2 h', () => {
    expect(IMPORT_STALE_AFTER_HOURS).toBe(32);
    // 2026-01-14T04:00Z → 2026-01-15T12:00Z = 32 h exactly: not past it.
    const atEdge = assessLastImport(
      { status: 'SUCCESS', finishedAt: new Date('2026-01-14T04:00:00.000Z') },
      NOW,
    );
    expect(atEdge).toMatchObject({ ageHours: 32, stale: false });
    // One minute earlier, 03:59Z: 32 h 1 min = 32.0166… → 32.02 h, stale.
    const past = assessLastImport(
      { status: 'SUCCESS', finishedAt: new Date('2026-01-14T03:59:00.000Z') },
      NOW,
    );
    expect(past).toMatchObject({ ageHours: 32.02, stale: true });
  });
});

describe('healthReport', () => {
  it('is ok with the database up and a fresh successful import', () => {
    expect(healthReport('up', ok)).toEqual({
      status: 'ok',
      database: { status: 'up' },
      lastImport: ok,
    });
  });

  it.each<[string, ImportReport]>([
    ['the last import failed', { ...ok, status: 'FAILED' }],
    ['the last import is stale', { ...ok, ageHours: 30, stale: true }],
    ['the import never ran', { status: 'NEVER', finishedAt: null, ageHours: null, stale: true }],
  ])('is degraded when %s', (_label, lastImport) => {
    expect(healthReport('up', lastImport).status).toBe('degraded');
  });

  it('is down whenever the database is, whatever the import', () => {
    expect(healthReport('down', ok)).toEqual({
      status: 'down',
      database: { status: 'down' },
      lastImport: ok,
    });
  });
});
