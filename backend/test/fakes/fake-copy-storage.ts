// TS-03 / TS-07: a hand-written fake of the part of `StorageService` (the R2 port, AR-10) that
// keeps the copies of a property's files: two buckets in memory, the public catalogue's and the
// private one (SC-18), told apart the way the real service tells them, by the `private/` prefix.
// Nothing reaches Cloudflare.
import { isPrivateFileKey, type StorageService } from '../../src/storage/storage.service.js';

type Port = Pick<
  StorageService,
  | 'isConfigured'
  | 'isPrivateStorageConfigured'
  | 'uploadBuffer'
  | 'publicUrlFor'
  | 'issuePrivateFileLink'
>;

export class FakeCopyStorage implements Port {
  /** The public bucket: key -> bytes and content type. */
  readonly publicFiles = new Map<string, { body: Buffer; contentType: string }>();
  /** The private bucket: key -> bytes and content type. */
  readonly privateFiles = new Map<string, { body: Buffer; contentType: string }>();
  publicConfigured = true;
  /** False behaves like an unset R2_PRIVATE_BUCKET: the matrícula must not be copied at all. */
  privateConfigured = true;
  failUploads = false;
  /** Every key a private link was issued for. */
  readonly linkRequests: string[] = [];

  isConfigured(): boolean {
    return this.publicConfigured;
  }

  isPrivateStorageConfigured(): boolean {
    return this.publicConfigured && this.privateConfigured;
  }

  async uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<{ key: string; size: number }> {
    if (this.failUploads) throw new Error('storage unavailable');
    if (isPrivateFileKey(key)) {
      // The real service refuses a private key with no private bucket; never the public one.
      if (!this.privateConfigured) throw new Error('The private file bucket is not configured');
      this.privateFiles.set(key, { body: buffer, contentType });
    } else {
      this.publicFiles.set(key, { body: buffer, contentType });
    }
    return { key, size: buffer.length };
  }

  publicUrlFor(key: string): string {
    if (isPrivateFileKey(key)) throw new Error('A private file has no public URL');
    return `https://files.example.test/${key}`;
  }

  async issuePrivateFileLink(key: string): Promise<string> {
    if (!this.privateFiles.has(key)) throw new Error('no such private file');
    this.linkRequests.push(key);
    return `https://private-files.example.test/signed/${encodeURIComponent(key)}?X-Amz-Expires=60`;
  }

  /** Every key stored, public and private. */
  allKeys(): string[] {
    return [...this.publicFiles.keys(), ...this.privateFiles.keys()].sort();
  }
}
