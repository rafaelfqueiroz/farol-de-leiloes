// SPEC-010 BR-010-11: requesting and downloading an export, over a hand-written repository and a
// fake storage (TS-03, TS-07). The real races and the 404 equality on MongoDB are in
// test/integration/privacy-export.spec.ts.
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../common/errors/domain-error.js';
import { DAY, FakeClock } from '../../../test/fakes/fake-clock.js';
import { FakeStorage } from '../../../test/fakes/fake-storage.js';
import type { ExportStatus } from '../domain/data-export.js';
import { DataExportService } from './data-export.service.js';
import type { DataExportRecord } from './data-exports.repository.js';

const USER = '64b000000000000000000001';
const READY_AT = new Date('2026-03-10T15:00:00.000Z');

function record(status: ExportStatus, overrides: Partial<DataExportRecord> = {}): DataExportRecord {
  return {
    id: '64b0000000000000000000e1',
    userId: USER,
    status,
    requestedAt: READY_AT,
    ...overrides,
  };
}

function build(found: DataExportRecord | null) {
  const clock = new FakeClock(READY_AT);
  const storage = new FakeStorage();
  const exportsRepo = {
    insertQueued: async () => null as DataExportRecord | null,
    findLiveOf: async () => null as DataExportRecord | null,
    findOwned: async (userId: string) => (userId === USER ? found : null),
    pageOf: async () => ({ items: found ? [found] : [], total: found ? 1 : 0 }),
  };
  const service = new DataExportService(exportsRepo as never, storage as never, clock);
  return { service, clock, storage, exportsRepo };
}

describe('request', () => {
  it('answers the export it queued, without the file key or the owner', async () => {
    const { service, exportsRepo } = build(null);
    exportsRepo.insertQueued = async () => record('queued', { fileKey: 'private/exports/x.json' });

    expect(await service.request(USER)).toEqual({
      id: '64b0000000000000000000e1',
      status: 'queued',
      requestedAt: READY_AT,
    });
  });

  it('answers the live one when the insert is refused (one live export per account)', async () => {
    const { service, exportsRepo } = build(null);
    exportsRepo.findLiveOf = async () =>
      record('ready', { readyAt: READY_AT, expiresAt: new Date(READY_AT.getTime() + 7 * DAY) });

    expect(await service.request(USER)).toMatchObject({ status: 'ready', readyAt: READY_AT });
  });

  it('tries the insert again when the live one finished between the two calls', async () => {
    const { service, exportsRepo } = build(null);
    let inserts = 0;
    exportsRepo.insertQueued = async () => (++inserts === 2 ? record('queued') : null);

    expect((await service.request(USER)).status).toBe('queued');
    expect(inserts).toBe(2);
  });

  it('gives up with an error after three lost races', async () => {
    await expect(build(null).service.request(USER)).rejects.toThrow('could not be queued');
  });

  it('shows a failed export’s code', async () => {
    const { service, exportsRepo } = build(null);
    exportsRepo.insertQueued = async () => record('failed', { errorCode: 'EXPORT_BUILD_FAILED' });

    expect(await service.request(USER)).toMatchObject({ errorCode: 'EXPORT_BUILD_FAILED' });
  });
});

describe('list', () => {
  it('wraps the page in the AR-35 envelope', async () => {
    const { service } = build(record('queued'));

    expect(await service.list(USER, { page: 2, pageSize: 5 })).toEqual({
      items: [expect.objectContaining({ status: 'queued' })],
      total: 1,
      page: 2,
      pageSize: 5,
    });
  });
});

describe('downloadLink', () => {
  const KEY = 'private/exports/abc.json';
  const ready = (expiresAt = new Date(READY_AT.getTime() + 7 * DAY)) =>
    record('ready', { fileKey: KEY, readyAt: READY_AT, expiresAt });
  const code = async (promise: Promise<unknown>) =>
    ((await promise.catch((e: unknown) => e)) as DomainError).code;

  it('issues the 60-second link to the owner of a ready export', async () => {
    const { service, storage } = build(ready());
    storage.files.set(KEY, Buffer.from('{}'));

    const link = await service.downloadLink(USER, '64b0000000000000000000e1');

    expect(link.expiresInSeconds).toBe(60);
    expect(link.url).toContain(encodeURIComponent(KEY));
  });

  it('another account, or a missing export, is NOT_FOUND', async () => {
    expect(await code(build(ready()).service.downloadLink('another', 'id'))).toBe('NOT_FOUND');
    expect(await code(build(null).service.downloadLink(USER, 'id'))).toBe('NOT_FOUND');
  });

  it.each([
    ['queued', record('queued'), 'EXPORT_NOT_READY'],
    ['failed', record('failed'), 'NOT_FOUND'],
    ['cancelled', record('cancelled'), 'NOT_FOUND'],
    ['expired', record('expired'), 'EXPORT_EXPIRED'],
    [
      'a ready export without a key',
      record('ready', { expiresAt: new Date(READY_AT.getTime() + DAY) }),
      'EXPORT_EXPIRED',
    ],
  ])('%s is refused with its stable code', async (_label, stored, expected) => {
    expect(await code(build(stored).service.downloadLink(USER, 'id'))).toBe(expected);
  });

  it('is refused from exactly 7 days on', async () => {
    const { service, clock } = build(ready());
    clock.set(new Date(READY_AT.getTime() + 7 * DAY));

    expect(await code(service.downloadLink(USER, 'id'))).toBe('EXPORT_EXPIRED');
  });
});
