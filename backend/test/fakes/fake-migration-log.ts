import type { MigrationLog } from '../../src/migrations/migration-log.js';

/**
 * TS-03: an in-memory fake of the `MigrationLog` port. Like the MongoDB log, recording an id
 * twice fails (there it is the unique `_id`).
 */
export class FakeMigrationLog implements MigrationLog {
  readonly records = new Map<string, Date>();

  constructor(alreadyApplied: Record<string, Date> = {}) {
    for (const [id, at] of Object.entries(alreadyApplied)) this.records.set(id, at);
  }

  async appliedIds(): Promise<ReadonlySet<string>> {
    return new Set(this.records.keys());
  }

  async record(id: string, appliedAt: Date): Promise<void> {
    if (this.records.has(id)) throw new Error(`duplicate key: ${id}`);
    this.records.set(id, appliedAt);
  }
}
