// SPEC-010 BR-010-10, BR-010-11, SC-18: the export worker's decisions over hand-written collaborators
// (TS-03, TS-07). The conditional transitions and the races on MongoDB are in
// test/integration/account-closure.spec.ts and privacy-export.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { DAY, FakeClock } from '../../../test/fakes/fake-clock.js';
import { FakeStorage } from '../../../test/fakes/fake-storage.js';
import { testBusinessConfig } from '../../../test/support/test-env.js';
import { DataExportWorker, EXPORT_BATCH_SIZE, newExportFileKey } from './data-export.worker.js';
import type { DataExportRecord } from './data-exports.repository.js';

const USER = '64b000000000000000000001';
const KEY = 'private/exports/fixed.json';

const claimed = (): DataExportRecord => ({
  id: 'e1',
  userId: USER,
  status: 'queued',
  requestedAt: new Date(0),
  fileKey: KEY,
});

function build(options: { account?: object | null } = {}) {
  const clock = new FakeClock();
  const storage = new FakeStorage();
  const queue = [claimed()];
  const exportsRepo = {
    hasQueued: vi.fn().mockResolvedValue(true),
    claimNextQueued: vi.fn(async () => queue.shift() ?? null),
    markReady: vi.fn().mockResolvedValue(true),
    markFailed: vi.fn().mockResolvedValue(true),
    findDeadWithFile: vi.fn().mockResolvedValue(null),
    clearFileKey: vi.fn().mockResolvedValue(undefined),
    findDueForExpiry: vi.fn().mockResolvedValue([]),
    markExpired: vi.fn().mockResolvedValue(true),
    findWithStaleFile: vi.fn().mockResolvedValue([]),
  };
  const registry = { collect: vi.fn().mockResolvedValue({ account: { id: USER } }) };
  const contexts = { forAccount: vi.fn().mockResolvedValue({ accountId: USER }) };
  const users = {
    findById: vi
      .fn()
      .mockResolvedValue(
        options.account === undefined ? { status: 'active', isAdmin: false } : options.account,
      ),
  };
  const worker = new DataExportWorker(
    exportsRepo as never,
    registry as never,
    contexts as never,
    users as never,
    storage as never,
    clock,
    testBusinessConfig(),
  );
  return { worker, exportsRepo, registry, contexts, users, storage, clock };
}

describe('newExportFileKey', () => {
  it('is random, private and carries nothing of anyone', () => {
    const [a, b] = [newExportFileKey(), newExportFileKey()];

    expect(a).toMatch(/^private\/exports\/[0-9a-f]{48}\.json$/);
    expect(a).not.toBe(b);
  });
});

describe('processQueued', () => {
  it('builds under the account’s own context, uploads, and marks ready with the 7-day expiry', async () => {
    const { worker, exportsRepo, contexts, storage, clock } = build();

    expect(await worker.processQueued()).toEqual({ ready: 1, failed: 0, discarded: 0 });

    expect(contexts.forAccount).toHaveBeenCalledWith({ userId: USER, isAdmin: false });
    expect(storage.onlyFile()).toMatchObject({ schemaVersion: 1, account: { id: USER } });
    const [id, , readyAt, expiresAt] = exportsRepo.markReady.mock.calls[0] as unknown as [
      string,
      string,
      Date,
      Date,
    ];
    expect(id).toBe('e1');
    expect(expiresAt).toEqual(new Date(readyAt.getTime() + 7 * DAY));
    expect(readyAt).toEqual(clock.now());
  });

  it('stops at the batch size and when nothing is queued', async () => {
    const { worker, exportsRepo } = build();
    exportsRepo.claimNextQueued.mockImplementation(async () => claimed());

    await worker.processQueued();

    expect(exportsRepo.claimNextQueued).toHaveBeenCalledTimes(EXPORT_BATCH_SIZE);
    expect(await build().worker.hasWork()).toBe(true);
  });

  it('SC-18: without the private bucket it fails with a stable code and writes nothing anywhere', async () => {
    const { worker, exportsRepo, storage } = build();
    storage.privateConfigured = false;

    expect(await worker.processQueued()).toEqual({ ready: 0, failed: 1, discarded: 0 });
    expect(exportsRepo.markFailed).toHaveBeenCalledWith(
      'e1',
      expect.any(String),
      'EXPORT_STORAGE_UNAVAILABLE',
      false,
    );
    expect(storage.files.size).toBe(0);
  });

  it('an account that is no longer active gets no file', async () => {
    for (const account of [null, { status: 'closed' }, { status: 'deactivated' }]) {
      const { worker, exportsRepo, storage } = build({ account });

      expect(await worker.processQueued()).toMatchObject({ failed: 1 });
      expect(exportsRepo.markFailed).toHaveBeenCalledWith(
        'e1',
        expect.any(String),
        'EXPORT_ACCOUNT_NOT_ACTIVE',
        false,
      );
      expect(storage.files.size).toBe(0);
    }
  });

  it('an account without a stored status is active (AR-28), and an admin is built as one', async () => {
    const { worker, contexts } = build({ account: { isAdmin: true } });

    expect(await worker.processQueued()).toMatchObject({ ready: 1 });
    expect(contexts.forAccount).toHaveBeenCalledWith({ userId: USER, isAdmin: true });
  });

  it('a provider failing is EXPORT_BUILD_FAILED, logged by code only, with no file', async () => {
    const { worker, registry, exportsRepo, storage } = build();
    registry.collect.mockRejectedValue(new TypeError('quotes ana@example.test'));

    expect(await worker.processQueued()).toMatchObject({ failed: 1 });
    expect(exportsRepo.markFailed).toHaveBeenCalledWith(
      'e1',
      expect.any(String),
      'EXPORT_BUILD_FAILED',
      false,
    );
    expect(storage.files.size).toBe(0);
  });

  it('a failed upload keeps the key on the row (the object may exist) for the cleanup', async () => {
    const { worker, exportsRepo, storage } = build();
    storage.failUploads = true;

    expect(await worker.processQueued()).toMatchObject({ failed: 1 });
    expect(exportsRepo.markFailed).toHaveBeenCalledWith(
      'e1',
      expect.any(String),
      'EXPORT_STORAGE_UNAVAILABLE',
      true,
    );
  });

  it('when the export was cancelled meanwhile the file it wrote is deleted and the key cleared', async () => {
    const { worker, exportsRepo, storage } = build();
    exportsRepo.markReady.mockResolvedValue(false);
    exportsRepo.findDeadWithFile.mockResolvedValue({ ...claimed(), status: 'cancelled' });

    expect(await worker.processQueued()).toEqual({ ready: 0, failed: 0, discarded: 1 });

    expect(storage.files.size).toBe(0);
    expect(storage.deleteRequests).toEqual([KEY]);
    expect(exportsRepo.clearFileKey).toHaveBeenCalledWith('e1');
  });

  it('when another worker owns the export (still live) the file is left alone', async () => {
    const { worker, exportsRepo, storage } = build();
    exportsRepo.markReady.mockResolvedValue(false);

    expect(await worker.processQueued()).toMatchObject({ discarded: 1 });
    expect(storage.deleteRequests).toEqual([]);
  });

  it('a failed delete keeps the key so the cleanup retries', async () => {
    const { worker, exportsRepo, storage } = build();
    exportsRepo.markReady.mockResolvedValue(false);
    exportsRepo.findDeadWithFile.mockResolvedValue({ ...claimed(), status: 'cancelled' });
    storage.failDeletes = true;

    await worker.processQueued();

    expect(exportsRepo.clearFileKey).not.toHaveBeenCalled();
  });
});

describe('expireDue', () => {
  it('deletes the file of a due export before marking it expired', async () => {
    const { worker, exportsRepo, storage } = build();
    exportsRepo.findDueForExpiry.mockResolvedValue([{ ...claimed(), status: 'ready' }]);
    storage.files.set(KEY, Buffer.from('{}'));

    expect(await worker.expireDue()).toEqual({ expired: 1, cleaned: 0, failed: 0 });
    expect(storage.files.size).toBe(0);
    expect(exportsRepo.markExpired).toHaveBeenCalledWith('e1');
  });

  it('a file that cannot be deleted keeps the export as it is for the next run', async () => {
    const { worker, exportsRepo, storage } = build();
    exportsRepo.findDueForExpiry.mockResolvedValue([{ ...claimed(), status: 'ready' }]);
    storage.failDeletes = true;

    expect(await worker.expireDue()).toEqual({ expired: 0, cleaned: 0, failed: 1 });
    expect(exportsRepo.markExpired).not.toHaveBeenCalled();
  });

  it('a due export with no key is just marked expired', async () => {
    const { worker, exportsRepo } = build();
    exportsRepo.findDueForExpiry.mockResolvedValue([
      { ...claimed(), fileKey: undefined, status: 'ready' },
    ]);

    expect(await worker.expireDue()).toMatchObject({ expired: 1 });
  });

  it('cleans the files of failed and cancelled rows, and counts the ones it could not', async () => {
    const { worker, exportsRepo, storage } = build();
    exportsRepo.findWithStaleFile.mockResolvedValue([
      { ...claimed(), id: 'a', status: 'failed' },
      { ...claimed(), id: 'b', fileKey: undefined, status: 'cancelled' },
    ]);

    expect(await worker.expireDue()).toEqual({ expired: 0, cleaned: 1, failed: 1 });
    expect(exportsRepo.clearFileKey).toHaveBeenCalledWith('a');
    expect(storage.deleteRequests).toEqual([KEY]);
  });
});
