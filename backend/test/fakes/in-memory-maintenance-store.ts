import { paginated, skipOf } from '../../src/common/pagination/paginated.js';
import type { PageRequest, Paginated } from '../../src/common/pagination/paginated.js';
import type { UpcomingBounds } from '../../src/maintenance/domain/maintenance-window.js';
import type {
  MaintenanceRecord,
  NewMaintenanceRecord,
} from '../../src/maintenance/maintenance-record.js';
import { MaintenanceStore } from '../../src/maintenance/maintenance.store.js';

/** TS-03: a hand-written fake of the storage port; it counts reads so a test can see the cache. */
export class InMemoryMaintenanceStore extends MaintenanceStore {
  records: MaintenanceRecord[] = [];
  upcomingReads = 0;
  private sequence = 0;

  insert(record: NewMaintenanceRecord): Promise<MaintenanceRecord> {
    this.sequence += 1;
    const stored: MaintenanceRecord = {
      ...record,
      id: `64b7f0000000000000ee${String(this.sequence).padStart(4, '0')}`,
      createdAt: record.announcedAt,
    };
    this.records.push(stored);
    return Promise.resolve(stored);
  }

  findPage(page: PageRequest): Promise<Paginated<MaintenanceRecord>> {
    const sorted = [...this.records].sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());
    return Promise.resolve(
      paginated(sorted.slice(skipOf(page), skipOf(page) + page.pageSize), sorted.length, page),
    );
  }

  findUpcoming(bounds: UpcomingBounds, limit: number): Promise<MaintenanceRecord[]> {
    this.upcomingReads += 1;
    return Promise.resolve(
      this.records
        .filter((r) => r.endsAt > bounds.endsAfter && r.startsAt <= bounds.startsBy)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .slice(0, limit),
    );
  }

  deleteNotStarted(id: string, startsAfter: Date): Promise<boolean> {
    const index = this.records.findIndex((r) => r.id === id && r.startsAt > startsAfter);
    if (index < 0) return Promise.resolve(false);
    this.records.splice(index, 1);
    return Promise.resolve(true);
  }

  exists(id: string): Promise<boolean> {
    return Promise.resolve(this.records.some((r) => r.id === id));
  }
}
