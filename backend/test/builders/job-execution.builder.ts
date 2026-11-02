import { JobExecution, RunMode } from '../../src/common/schemas/job-execution.schema';
import { DEFAULT_FAKE_NOW } from '../fakes/fake-clock';

/**
 * TS-29: builds a `JobExecution` with sensible defaults so a test states only what it cares
 * about:
 *
 *   aJobExecution().named('import-csv').finishedAt(clock.now()).build()
 *
 * `build()` returns a plain object, ready for `Model.create()` or a fake repository.
 */
export class JobExecutionBuilder {
  private props: JobExecution = {
    jobName: 'test-job',
    runMode: RunMode.AUTO,
    finishedAt: new Date(DEFAULT_FAKE_NOW.getTime()),
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

  finishedAt(finishedAt: Date): this {
    this.props.finishedAt = new Date(finishedAt.getTime());
    return this;
  }

  build(): JobExecution {
    return { ...this.props, finishedAt: new Date(this.props.finishedAt.getTime()) };
  }
}

export function aJobExecution(): JobExecutionBuilder {
  return new JobExecutionBuilder();
}
