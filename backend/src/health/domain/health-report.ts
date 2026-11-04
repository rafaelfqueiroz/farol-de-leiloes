// AR-48: what GET /api/health reports, decided from plain inputs (AR-05: no framework, the time
// as an argument). The database is up or down; the last Caixa import succeeded, failed or never
// ran, and is stale when older than the threshold below.

/**
 * The import runs daily at 03:00 Brasília (24 h between runs), plus 2 h for a slow run and a late
 * scheduler tick: past 26 h, a run was missed.
 */
export const IMPORT_STALE_AFTER_HOURS = 26;

const HOUR_MS = 60 * 60 * 1000;

export type HealthStatus = 'ok' | 'degraded' | 'down';
export type DatabaseStatus = 'up' | 'down';
export type ImportStatus = 'SUCCESS' | 'FAILED' | 'NEVER';

/** The last recorded run of the import, in any run mode. */
export interface LastImportRun {
  status: 'SUCCESS' | 'FAILED';
  finishedAt: Date;
}

export interface ImportReport {
  status: ImportStatus;
  /** ISO 8601, null when the import never ran. */
  finishedAt: string | null;
  /** Hours since the run finished, to two decimals; null when it never ran. */
  ageHours: number | null;
  /** True when the run is older than IMPORT_STALE_AFTER_HOURS, or there was none. */
  stale: boolean;
}

export interface HealthReport {
  status: HealthStatus;
  database: { status: DatabaseStatus };
  lastImport: ImportReport;
}

export function assessLastImport(last: LastImportRun | null, now: Date): ImportReport {
  if (!last) return { status: 'NEVER', finishedAt: null, ageHours: null, stale: true };
  const ageHours = (now.getTime() - last.finishedAt.getTime()) / HOUR_MS;
  return {
    status: last.status,
    finishedAt: last.finishedAt.toISOString(),
    ageHours: Math.round(ageHours * 100) / 100,
    stale: ageHours > IMPORT_STALE_AFTER_HOURS,
  };
}

/**
 * `down` only when the database is unreachable (the API cannot serve anything); `degraded` when
 * it can, but the auction data may be out of date: the last import failed, is stale or never ran.
 */
export function healthReport(database: DatabaseStatus, lastImport: ImportReport): HealthReport {
  const status: HealthStatus =
    database === 'down'
      ? 'down'
      : lastImport.status !== 'SUCCESS' || lastImport.stale
        ? 'degraded'
        : 'ok';
  return { status, database: { status: database }, lastImport };
}
