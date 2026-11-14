// AR-46: every job run gets its own correlation id plus its job name, so the lines of one run of
// the import can be told apart from the next. Every @Cron method carries @InJobContext
// (test/structural/cron-job-context.spec.ts enforces it); runs started some other way (the
// startup import) call runInJobContext directly.
import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { runWithLogContext } from './log-context.js';

/** Runs `fn` in a fresh job log context: a new correlation id and `jobName`. */
export function runInJobContext<T>(jobName: string, fn: () => T): T {
  return runWithLogContext({ correlationId: randomUUID(), jobName }, fn);
}

/**
 * Method decorator: each call of the method is one job run, in its own log context. The wrapper
 * keeps the original method's metadata (the @Cron options @nestjs/schedule reads from the
 * method), so it works above or below @Cron.
 */
export function InJobContext(jobName: string): MethodDecorator {
  return (_target, _key, descriptor) => {
    const original: unknown = descriptor.value;
    if (typeof original !== 'function') {
      throw new TypeError(`@InJobContext('${jobName}') decorates a method`);
    }
    const wrapped = function (this: unknown, ...args: unknown[]): unknown {
      return runInJobContext(jobName, () =>
        (original as (...a: unknown[]) => unknown).apply(this, args),
      );
    };
    for (const key of Reflect.getMetadataKeys(original) as unknown[]) {
      Reflect.defineMetadata(key, Reflect.getMetadata(key, original), wrapped);
    }
    Object.defineProperty(wrapped, 'name', { value: original.name });
    descriptor.value = wrapped as typeof descriptor.value;
  };
}
