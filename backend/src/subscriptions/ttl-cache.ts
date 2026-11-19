// A small in-memory cache for provider reads (the invoice list, an upgrade preview): entries expire
// by the injected clock's instants, expired ones are evicted whenever something is written, and the
// size is capped (oldest first), so a long-running process holds a bounded amount however many
// offices ask. Not shared between replicas: each one reads the provider at most once per TTL.
export class TtlCache<V> {
  private readonly entries = new Map<string, { until: number; value: V }>();

  constructor(private readonly maxEntries: number) {}

  /** The value if it has not expired at `now` (epoch ms). */
  get(key: string, now: number): V | undefined {
    const entry = this.entries.get(key);
    return entry !== undefined && entry.until > now ? entry.value : undefined;
  }

  set(key: string, value: V, now: number, ttlMs: number): void {
    // an entry of an old read must not be kept in front of a newer one
    this.entries.delete(key);
    for (const [other, entry] of this.entries) {
      if (entry.until <= now) this.entries.delete(other);
    }
    // insertion order is age order: drop the oldest until there is room
    for (const oldest of this.entries.keys()) {
      if (this.entries.size < this.maxEntries) break;
      this.entries.delete(oldest);
    }
    this.entries.set(key, { until: now + ttlMs, value });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  /** Drops every entry whose key starts with `prefix` (everything cached for one subscription). */
  deleteByPrefix(prefix: string): void {
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
