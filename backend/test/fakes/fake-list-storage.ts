// TS-03 / TS-07: a hand-written fake of the part of `StorageService` (the R2 port, AR-10) that holds
// the day's copy of the Caixa list: files in memory, nothing reaches Cloudflare. It can be told it
// is not configured (development without R2) or that reads fail.
import type { StorageService } from '../../src/storage/storage.service.js';

type Port = Pick<StorageService, 'isConfigured' | 'uploadBuffer' | 'downloadBuffer'>;

export class FakeListStorage implements Port {
  readonly files = new Map<string, Buffer>();
  /** False behaves like R2 not set up: the list is never stored. */
  configured = true;
  /** Makes every read fail, as unreachable storage would. */
  failReads = false;

  isConfigured(): boolean {
    return this.configured;
  }

  async uploadBuffer(key: string, buffer: Buffer): Promise<{ key: string; size: number }> {
    this.files.set(key, buffer);
    return { key, size: buffer.length };
  }

  async downloadBuffer(key: string): Promise<Buffer> {
    if (this.failReads) throw new Error('storage unavailable');
    const file = this.files.get(key);
    if (file === undefined) throw new Error('no such file');
    return file;
  }
}
