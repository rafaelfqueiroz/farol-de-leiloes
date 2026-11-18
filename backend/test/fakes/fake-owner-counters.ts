import type { AccessContext, ActingOwner } from '../../src/access/access-context.js';
import type {
  CountedOwner,
  OwnerCounterRepository,
} from '../../src/access/owner-counter.repository.js';
import { DomainError } from '../../src/common/errors/domain-error.js';

type Port<T> = { [K in keyof T]: T[K] };

/** The slice of the counter repository the journey slots use. */
type CounterPort = Pick<
  Port<OwnerCounterRepository>,
  'ensureCounter' | 'tryAcquire' | 'release' | 'readValue'
>;

/**
 * TS-03: an in-memory fake of the owner counters with the semantics the slot service relies on:
 * `tryAcquire` takes a slot only below the limit (limit 0 never), refuses an owner that may not be
 * written (OFFICE_READ_ONLY), `release` never goes below zero, a read works for any owner the
 * caller conducts. The real conditional update under concurrency is proven against MongoDB in
 * test/integration/journey-slots.spec.ts (TS-02).
 */
export class FakeOwnerCounters implements CounterPort {
  private readonly values = new Map<string, number>();

  /** Seeds an office's counter, e.g. `counters.set(OFFICE, 'journeys.active', 4)`. */
  set(officeId: string, key: string, value: number): void {
    this.values.set(`${officeId}:${key}`, value);
  }

  get(officeId: string, key: string): number {
    return this.values.get(`${officeId}:${key}`) ?? 0;
  }

  async ensureCounter(
    ctx: AccessContext,
    key: string,
    options: { actingOwner?: ActingOwner } = {},
  ): Promise<void> {
    const owner = this.writable(ctx, options.actingOwner);
    if (!this.values.has(`${owner.ownerId}:${key}`)) this.values.set(`${owner.ownerId}:${key}`, 0);
  }

  async tryAcquire(
    ctx: AccessContext,
    key: string,
    limit: number,
    options: { actingOwner?: ActingOwner } = {},
  ): Promise<boolean> {
    const owner = this.writable(ctx, options.actingOwner);
    if (limit === 0) return false;
    const at = `${owner.ownerId}:${key}`;
    const value = this.values.get(at) ?? 0;
    if (value >= limit) return false;
    this.values.set(at, value + 1);
    return true;
  }

  async release(ctx: AccessContext, owner: CountedOwner, key: string): Promise<boolean> {
    const ownerId = String(owner.ownerId);
    if (!ctx.canWriteOwner({ ownerType: owner.ownerType, ownerId })) {
      throw new Error('A slot is released only for an owner the request may write to (AR-12)');
    }
    const value = this.values.get(`${ownerId}:${key}`) ?? 0;
    if (value <= 0) return false;
    this.values.set(`${ownerId}:${key}`, value - 1);
    return true;
  }

  async readValue(
    ctx: AccessContext,
    key: string,
    options: { actingOwner?: ActingOwner } = {},
  ): Promise<number> {
    const acting = options.actingOwner ?? ctx.resolveActingOwner();
    return this.values.get(`${acting.owner.ownerId}:${key}`) ?? 0;
  }

  private writable(ctx: AccessContext, actingOwner?: ActingOwner) {
    const acting = actingOwner ?? ctx.resolveActingOwner();
    if (!ctx.canWriteOwner(acting.owner)) throw new DomainError('OFFICE_READ_ONLY');
    return acting.owner;
  }
}
