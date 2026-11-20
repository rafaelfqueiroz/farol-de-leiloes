// TS-03 / TS-07: a hand-written fake of the private-file part of `StorageService` (the R2 port,
// AR-10): files in memory, nothing reaches Cloudflare. It implements the real signatures, so a
// change to `StorageService` that the data export relies on breaks this at compile time, and it can
// be told to fail the way storage fails (unavailable, refuses deletes), or to run code at the moment
// a file is written (a closure racing the export worker).
import type { StorageService } from '../../src/storage/storage.service.js';

type Port = Pick<
  StorageService,
  'isPrivateStorageConfigured' | 'uploadBuffer' | 'deleteFile' | 'issuePrivateFileLink'
>;

export class FakeStorage implements Port {
  /** The private bucket: key -> content. */
  readonly files = new Map<string, Buffer>();
  /** False behaves like an unset R2_PRIVATE_BUCKET (SC-18): the export must fail, never fall back. */
  privateConfigured = true;
  /** Makes every upload fail, as unreachable storage would. */
  failUploads = false;
  /** Makes every delete answer false, as unreachable storage would (the file stays). */
  failDeletes = false;
  /** Runs right after a file is stored and before `uploadBuffer` answers: a race in the worker. */
  afterStore: ((key: string) => Promise<void>) | undefined;
  /** Every key a delete was asked for, in order (a missing object counts: deletes are idempotent). */
  readonly deleteRequests: string[] = [];
  /** Every key a link was issued for. */
  readonly linkRequests: string[] = [];

  isPrivateStorageConfigured(): boolean {
    return this.privateConfigured;
  }

  async uploadBuffer(key: string, buffer: Buffer): Promise<{ key: string; size: number }> {
    if (!this.privateConfigured) throw new Error('The private file bucket is not configured');
    if (this.failUploads) throw new Error('storage unavailable');
    this.files.set(key, buffer);
    await this.afterStore?.(key);
    return { key, size: buffer.length };
  }

  async deleteFile(key: string): Promise<boolean> {
    this.deleteRequests.push(key);
    if (this.failDeletes) return false;
    this.files.delete(key);
    return true;
  }

  async issuePrivateFileLink(key: string): Promise<string> {
    if (!this.files.has(key)) throw new Error('no such file');
    this.linkRequests.push(key);
    return `https://private-files.example.test/signed/${encodeURIComponent(key)}?X-Amz-Expires=60`;
  }

  /** The JSON of the only file in the bucket (the specs build one export at a time). */
  onlyFile(): Record<string, unknown> {
    const [only, ...rest] = [...this.files.values()];
    if (!only || rest.length > 0) {
      throw new Error(`expected exactly one stored file, found ${this.files.size}`);
    }
    return JSON.parse(only.toString('utf8')) as Record<string, unknown>;
  }
}
