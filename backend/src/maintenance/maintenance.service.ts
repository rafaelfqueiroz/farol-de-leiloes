// SPEC-003 BR-003-03: maintenance windows announced inside the product. The rules are in
// domain/; this orchestrates the Clock (AR-24), the store (AR-08) and a short cache for the public
// banner.
import { Injectable, Logger } from '@nestjs/common';
import { parseISO } from 'date-fns';
import { Clock } from '../common/clock/clock.js';
import { inBrasilia } from '../common/clock/brasilia-time.js';
import { DomainError } from '../common/errors/domain-error.js';
import type { PageRequest, Paginated } from '../common/pagination/paginated.js';
import {
  invalidWindowFields,
  isUpcomingOrInProgress,
  upcomingBounds,
} from './domain/maintenance-window.js';
import type { MaintenanceRecord } from './maintenance-record.js';
import { MaintenanceStore } from './maintenance.store.js';

/** The longest announcement text (a banner line, not an essay). */
export const MAX_MESSAGE_LENGTH = 500;

/** The banner shows at most this many windows at once; a lean, bounded public read. */
export const UPCOMING_LIMIT = 20;

/**
 * How long the public list is reused, by the injected Clock. The banner is requested on page
 * loads by every visitor; the data changes a few times a month. Create and delete drop the
 * cache at once, so an admin sees their change immediately.
 */
export const UPCOMING_CACHE_TTL_MS = 30_000;

export interface CreateMaintenanceInput {
  /** ISO 8601; without an offset it is read as Brasília time (AR-23). */
  startsAt: string;
  endsAt: string;
  message: string;
}

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);
  private cache: { loadedAt: number; records: MaintenanceRecord[] } | null = null;

  constructor(
    private readonly store: MaintenanceStore,
    private readonly clock: Clock, // AR-24
  ) {}

  /**
   * BR-003-03 / DL-003-03: a window announced with less than 48 h notice is accepted (an urgent
   * security patch) but the domain reports it as not announced in time, so it counts as
   * downtime. `announcedAt` is the server's now, never the caller's.
   */
  async create(input: CreateMaintenanceInput, adminId: string): Promise<MaintenanceRecord> {
    const now = this.clock.now();
    const startsAt = parseInstant(input.startsAt);
    const endsAt = parseInstant(input.endsAt);
    const message = input.message.trim();

    const fields = invalidWindowFields({ startsAt, endsAt }, now);
    if (message.length === 0 || message.length > MAX_MESSAGE_LENGTH) fields.push('message');
    if (fields.length > 0) throw new DomainError('VALIDATION_FAILED', { fields });

    const record = await this.store.insert({
      startsAt,
      endsAt,
      message,
      announcedAt: now,
      createdBy: adminId,
    });
    this.cache = null;
    // AR-46 / SC-15: the window id only. The operator is the request's hashed `userHash` in the
    // log context, never a raw account id inside the message; the text is not logged either.
    this.logger.log(`Maintenance window ${record.id} announced`);
    return record;
  }

  /** AR-35: every window, newest start first (admin). */
  findPage(page: PageRequest): Promise<Paginated<MaintenanceRecord>> {
    return this.store.findPage(page);
  }

  /** The windows in progress or starting within 14 days, soonest first (public). */
  async upcoming(): Promise<MaintenanceRecord[]> {
    const now = this.clock.now();
    const cached = this.cache;
    if (
      cached &&
      now.getTime() - cached.loadedAt >= 0 &&
      now.getTime() - cached.loadedAt < UPCOMING_CACHE_TTL_MS
    ) {
      return cached.records.filter((record) => isUpcomingOrInProgress(record, now));
    }
    const records = await this.store.findUpcoming(upcomingBounds(now), UPCOMING_LIMIT);
    this.cache = { loadedAt: now.getTime(), records };
    return records;
  }

  /** Only a window that has not started can be removed; once started it is part of the record. */
  async remove(id: string): Promise<void> {
    const deleted = await this.store.deleteNotStarted(id, this.clock.now());
    if (deleted) {
      this.cache = null;
      this.logger.log(`Maintenance window ${id} removed before it started`);
      return;
    }
    if (await this.store.exists(id)) {
      throw new DomainError('MAINTENANCE_WINDOW_ALREADY_STARTED', { id });
    }
    throw new DomainError('MAINTENANCE_WINDOW_NOT_FOUND');
  }
}

/** AR-23: an instant with no offset is Brasília time, never the server's zone. */
function parseInstant(value: string): Date {
  return new Date(parseISO(value, { in: inBrasilia }).getTime());
}
