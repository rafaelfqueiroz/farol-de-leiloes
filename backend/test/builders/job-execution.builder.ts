import { type JobExecutionRecord, JobStatus, RunMode } from '../../src/common/job-execution.js';
import { DEFAULT_FAKE_NOW } from '../fakes/fake-clock.js';

/**
 * TS-29: builds a `JobExecutionRecord` with sensible defaults so a test states only what it cares
 * about:
 *
 *   aJobExecution().named('import-csv').finishedAt(clock.now()).build()
 *
 * `build()` returns a plain object, ready for `Model.create()` or a fake repository.
 */
export class JobExecutionBuilder {
  private props: JobExecutionRecord = {
    jobName: 'test-job',
    runMode: RunMode.AUTO,
    finishedAt: new Date(DEFAULT_FAKE_NOW.getTime()),
    status: JobStatus.SUCCESS,
  };

  named(jobName: string): this {
    this.props.jobName = jobName;
    return this;
  }

  inMode(runMode: RunMode): this {
    this.props.runMode = runMode;
    return this;
  }

  manual(): this {
    return this.inMode(RunMode.MANUAL);
  }

  /** AR-03: a failed run, with its stable code. */
  failed(errorCode = 'Error'): this {
    this.props.status = JobStatus.FAILED;
    this.props.errorCode = errorCode;
    return this;
  }

  /** A row recorded before #36, when only successes were recorded and there was no status. */
  legacy(): this {
    delete this.props.status;
    delete this.props.errorCode;
    return this;
  }

  finishedAt(finishedAt: Date): this {
    this.props.finishedAt = new Date(finishedAt.getTime());
    return this;
  }

  build(): JobExecutionRecord {
    return { ...this.props, finishedAt: new Date(this.props.finishedAt.getTime()) };
  }
}

export function aJobExecution(): JobExecutionBuilder {
  return new JobExecutionBuilder();
}
