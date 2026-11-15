// SPEC-003 BR-003-03 through the service: the Clock sets announcedAt, validation, the cache and
// removal, against a hand-written fake store (TS-03) and a fake clock (TS-06).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { DomainError } from '../common/errors/domain-error.js';
import { announcedInTime } from './domain/maintenance-window.js';
import {
  MAX_MESSAGE_LENGTH,
  MaintenanceService,
  UPCOMING_CACHE_TTL_MS,
} from './maintenance.service.js';
import { FakeClock, HOUR, DAY } from '../../test/fakes/fake-clock.js';
import { InMemoryMaintenanceStore } from '../../test/fakes/in-memory-maintenance-store.js';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const ADMIN_ID = '64b7f0000000000000000001';

describe('MaintenanceService', () => {
  let clock: FakeClock;
  let store: InMemoryMaintenanceStore;
  let service: MaintenanceService;

  beforeEach(() => {
    clock = new FakeClock(NOW);
    store = new InMemoryMaintenanceStore();
    service = new MaintenanceService(store, clock);
    vi.restoreAllMocks();
  });

  const window = (startsInHours: number, durationHours = 2, message = 'Manutenção programada') => ({
    startsAt: new Date(NOW.getTime() + startsInHours * HOUR).toISOString(),
    endsAt: new Date(NOW.getTime() + (startsInHours + durationHours) * HOUR).toISOString(),
    message,
  });

  async function failure(promise: Promise<unknown>): Promise<DomainError> {
    return promise.then(
      () => {
        throw new Error('expected a DomainError');
      },
      (error: unknown) => error as DomainError,
    );
  }

  describe('create', () => {
    it('BR-003-03: sets announcedAt from the Clock and the creator from the admin', async () => {
      const created = await service.create(window(72), ADMIN_ID);

      expect(created.announcedAt).toEqual(NOW);
      expect(created.createdBy).toBe(ADMIN_ID);
      expect(announcedInTime(created)).toBe(true); // 72 h >= 48 h
    });

    it('BR-003-03 / DL-003-03: accepts 47 h notice but it is not announced in time', async () => {
      const created = await service.create(window(47), ADMIN_ID);
      expect(announcedInTime(created)).toBe(false);
    });

    it('BR-003-03: 48 h notice exactly is announced in time', async () => {
      const created = await service.create(window(48), ADMIN_ID);
      expect(announcedInTime(created)).toBe(true);
    });

    it('trims the message', async () => {
      const created = await service.create(window(72, 2, '  Manutenção  '), ADMIN_ID);
      expect(created.message).toBe('Manutenção');
    });

    it('AR-23: reads an instant without an offset as Brasília time', async () => {
      const created = await service.create(
        { startsAt: '2026-03-10T02:00', endsAt: '2026-03-10T04:00', message: 'Manutenção' },
        ADMIN_ID,
      );
      // Brasília is UTC-3: 02:00 -> 05:00Z
      expect(created.startsAt).toEqual(new Date('2026-03-10T05:00:00.000Z'));
      expect(created.endsAt).toEqual(new Date('2026-03-10T07:00:00.000Z'));
    });

    it('refuses a start in the past, naming the field only', async () => {
      const error = await failure(service.create(window(-1), ADMIN_ID));
      expect(error.code).toBe('VALIDATION_FAILED');
      expect(error.context).toEqual({ fields: ['startsAt'] });
      expect(store.records).toEqual([]);
    });

    it('refuses an end that is not after the start', async () => {
      const error = await failure(service.create(window(72, 0), ADMIN_ID));
      expect(error.context).toEqual({ fields: ['endsAt'] });
    });

    it('refuses an empty message', async () => {
      const error = await failure(service.create(window(72, 2, '   '), ADMIN_ID));
      expect(error.context).toEqual({ fields: ['message'] });
    });

    it('refuses a message over the cap and accepts one at the cap', async () => {
      const error = await failure(
        service.create(window(72, 2, 'a'.repeat(MAX_MESSAGE_LENGTH + 1)), ADMIN_ID),
      );
      expect(error.context).toEqual({ fields: ['message'] });
      await expect(
        service.create(window(72, 2, 'a'.repeat(MAX_MESSAGE_LENGTH)), ADMIN_ID),
      ).resolves.toBeDefined();
    });

    it('SC-15: logs the ids but never the message', async () => {
      const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      await service.create(window(72, 2, 'Texto do aviso'), ADMIN_ID);
      expect(log).toHaveBeenCalledTimes(1);
      const line = String(log.mock.calls[0]?.[0]);
      expect(line).toContain(ADMIN_ID);
      expect(line).not.toContain('Texto do aviso');
    });
  });

  describe('upcoming', () => {
    it('lists windows in progress or starting within 14 days, soonest first', async () => {
      await service.create(window(24 * 13), ADMIN_ID); // inside the horizon
      await service.create(window(24 * 15), ADMIN_ID); // beyond it
      await service.create(window(72), ADMIN_ID);
      store.records.push({
        ...(store.records[0] as (typeof store.records)[number]),
        id: 'in-progress',
        startsAt: new Date(NOW.getTime() - HOUR),
        endsAt: new Date(NOW.getTime() + HOUR),
      });

      const upcoming = await service.upcoming();

      expect(upcoming.map((w) => w.id)).toEqual([
        'in-progress',
        '64b7f0000000000000000003',
        '64b7f0000000000000000001',
      ]);
    });

    it('reuses the store read within the TTL, and reads again after it', async () => {
      await service.upcoming();
      clock.advance(UPCOMING_CACHE_TTL_MS - 1);
      await service.upcoming();
      expect(store.upcomingReads).toBe(1);

      clock.advance(1);
      await service.upcoming();
      expect(store.upcomingReads).toBe(2);
    });

    it('drops a window that ended while the cache was warm', async () => {
      await service.create(window(1, 1), ADMIN_ID); // 13:00Z to 14:00Z
      clock.set(new Date('2026-03-01T13:59:50.000Z'));
      expect((await service.upcoming()).length).toBe(1);

      clock.advance(20 * 1000); // 14:00:10Z: the end has passed, the cache is still warm
      expect(await service.upcoming()).toEqual([]);
      expect(store.upcomingReads).toBe(1);
    });

    it('treats a clock that went backwards as a cache miss', async () => {
      await service.upcoming();
      clock.set(new Date(NOW.getTime() - DAY));
      await service.upcoming();
      expect(store.upcomingReads).toBe(2);
    });

    it('drops the cache when a window is created, so the admin sees it at once', async () => {
      await service.upcoming();
      await service.create(window(72), ADMIN_ID);
      expect((await service.upcoming()).length).toBe(1);
      expect(store.upcomingReads).toBe(2);
    });

    it('drops the cache when a window is removed', async () => {
      const created = await service.create(window(72), ADMIN_ID);
      await service.upcoming();
      await service.remove(created.id);
      expect(await service.upcoming()).toEqual([]);
    });
  });

  describe('remove', () => {
    it('removes a window that has not started', async () => {
      const created = await service.create(window(72), ADMIN_ID);
      await service.remove(created.id);
      expect(store.records).toEqual([]);
    });

    it('refuses a window that started, with its id', async () => {
      const created = await service.create(window(72), ADMIN_ID);
      clock.set(new Date(created.startsAt.getTime())); // starts exactly now: started
      const error = await failure(service.remove(created.id));
      expect(error.code).toBe('MAINTENANCE_WINDOW_ALREADY_STARTED');
      expect(error.context).toEqual({ id: created.id });
      expect(store.records.length).toBe(1);
    });

    it('answers not found for an unknown id', async () => {
      const error = await failure(service.remove('64b7f00000000000000000ff'));
      expect(error.code).toBe('MAINTENANCE_WINDOW_NOT_FOUND');
    });
  });

  it('pages the admin list through the store', async () => {
    await service.create(window(72), ADMIN_ID);
    const page = await service.findPage({ page: 1, pageSize: 20 });
    expect(page.total).toBe(1);
  });
});
