/**
 * TS-03: a hand-written fake of the chainable Mongoose `Query`, for service specs that fake the
 * model (TS-01: no database in a unit spec). It answers every builder method by returning itself,
 * records the arguments each one received, and resolves to `result` when awaited or `exec()`ed.
 *
 *   const query = new FakeQuery([reminder]);
 *   const model = { find: vi.fn().mockReturnValue(query) };
 *   await service.list();
 *   expect(query.calls['limit']).toEqual([[100]]);
 *
 * Pass an `Error` to make the query reject instead.
 */
export class FakeQuery<T> implements PromiseLike<T> {
  /** The arguments of each call to a builder method, by method name, in call order. */
  readonly calls: Record<string, unknown[][]> = {};

  constructor(private readonly result: T | Error) {}

  private record(name: string, args: unknown[]): this {
    (this.calls[name] ??= []).push(args);
    return this;
  }

  populate(...args: unknown[]): this {
    return this.record('populate', args);
  }

  sort(...args: unknown[]): this {
    return this.record('sort', args);
  }

  skip(...args: unknown[]): this {
    return this.record('skip', args);
  }

  limit(...args: unknown[]): this {
    return this.record('limit', args);
  }

  select(...args: unknown[]): this {
    return this.record('select', args);
  }

  lean(...args: unknown[]): this {
    return this.record('lean', args);
  }

  exec(): Promise<T> {
    return this.result instanceof Error
      ? Promise.reject(this.result)
      : Promise.resolve(this.result);
  }

  then<R1 = T, R2 = never>(
    onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.exec().then(onFulfilled, onRejected);
  }
}
