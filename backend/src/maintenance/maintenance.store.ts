import type { PageRequest, Paginated } from '../common/pagination/paginated.js';
import type { UpcomingBounds } from './domain/maintenance-window.js';
import type { MaintenanceRecord, NewMaintenanceRecord } from './maintenance-record.js';

/**
 * What the service needs from storage. An abstract class so it is also the injection token, and
 * tests use a hand-written fake that implements it (TS-03).
 */
export abstract class MaintenanceStore {
  abstract insert(record: NewMaintenanceRecord): Promise<MaintenanceRecord>;
  /** Newest start first (AR-35). */
  abstract findPage(page: PageRequest): Promise<Paginated<MaintenanceRecord>>;
  /** Windows ending after `endsAfter` that start by `startsBy`, soonest first, at most `limit`. */
  abstract findUpcoming(bounds: UpcomingBounds, limit: number): Promise<MaintenanceRecord[]>;
  /** Deletes the window only if it starts after `startsAfter`; true when one was deleted. */
  abstract deleteNotStarted(id: string, startsAfter: Date): Promise<boolean>;
  abstract exists(id: string): Promise<boolean>;
}
