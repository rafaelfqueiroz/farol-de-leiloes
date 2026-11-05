// AR-09 / DV-09: jobs share this service contract, never the persistence schema.
export enum RunMode {
  MANUAL = 'MANUAL',
  AUTO = 'AUTO',
}

/** AR-03: the outcome of a run. */
export enum JobStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
}

export interface JobExecutionRecord {
  jobName: string;
  runMode: RunMode;
  finishedAt: Date;
  status?: JobStatus;
  errorCode?: string;
}

/** A legacy row's absent status is read as SUCCESS. */
export interface JobOutcome {
  status: `${JobStatus}`;
  runMode: `${RunMode}`;
  finishedAt: Date;
  errorCode?: string;
}
