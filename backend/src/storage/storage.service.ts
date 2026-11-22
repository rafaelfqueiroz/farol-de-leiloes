import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import r2Config from '../config/r2.config.js';
import { errorMessage } from '../common/error-message.js';
import { CAIXA_USER_AGENT } from '../common/caixa-user-agent.js';

/**
 * SPEC-002 BR-002-08 / SC-18: client files (journey documents and photos, SPEC-017) have keys under
 * this prefix and live in their own bucket, R2_PRIVATE_BUCKET, which has no public access — never in
 * R2_BUCKET, which R2_PUBLIC_URL serves openly. They never get a public URL; a download is a link
 * issued per request, after the caller's access was checked, by `issuePrivateFileLink`.
 */
export const PRIVATE_FILE_PREFIX = 'private/';

/** BR-002-09 / DL-002-06: a private file link stops working 60 seconds after it is issued. */
export const PRIVATE_FILE_LINK_SECONDS = 60;

/** A key under the private prefix, with no empty or dot segment that could climb out of it. */
export function isPrivateFileKey(key: unknown): key is string {
  if (typeof key !== 'string' || !key.startsWith(PRIVATE_FILE_PREFIX)) return false;
  const rest = key.slice(PRIVATE_FILE_PREFIX.length).split('/');
  return rest.every((segment) => segment !== '' && segment !== '.' && segment !== '..');
}

/** SC-15 / SC-18: a private key never reaches a log line. */
function loggableKey(key: string): string {
  return key.startsWith(PRIVATE_FILE_PREFIX) ? '[private file]' : key;
}

export interface UploadResult {
  key: string;
  url: string;
  size: number;
}

export interface DocumentUploadResult {
  key: string;
  url: string;
  size: number;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3Client: S3Client | null;
  private readonly bucket: string;
  private readonly publicUrl: string;
  /** SC-18: the client files' bucket; undefined until configured (SPEC-017). Never `bucket`. */
  private readonly privateBucket: string | undefined;

  constructor(
    @Inject(r2Config.KEY)
    private readonly config: ConfigType<typeof r2Config>,
  ) {
    const { accountId, accessKeyId, secretAccessKey, bucket, publicUrl, privateBucket } = config;
    // SC-18: validated at boot too (env.schema.ts); a client file must never land in the public
    // bucket, whatever built this config.
    if (privateBucket !== undefined && privateBucket === bucket) {
      throw new Error('The private bucket must not be the public one (SC-18)');
    }
    this.privateBucket = privateBucket || undefined;

    if (!accountId || !accessKeyId || !secretAccessKey) {
      this.logger.warn('R2 configuration incomplete - storage features disabled');
      this.s3Client = null;
      this.bucket = '';
      this.publicUrl = '';
      return;
    }

    this.s3Client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    this.bucket = bucket;
    this.publicUrl = publicUrl;
    this.logger.log('R2 storage service initialized');
  }

  isConfigured(): boolean {
    return this.s3Client !== null;
  }

  /**
   * SC-18: whether files under PRIVATE_FILE_PREFIX can be written, read and deleted: R2 is
   * configured AND R2_PRIVATE_BUCKET is set. A caller that must never fall back to the public bucket
   * (the data export, SPEC-010) asks this first and fails with a stable code of its own.
   */
  isPrivateStorageConfigured(): boolean {
    return this.s3Client !== null && this.privateBucket !== undefined;
  }

  /**
   * Upload an image from a URL to R2
   * Images are stored publicly for direct frontend access
   */
  async uploadImageFromUrl(sourceUrl: string, auctionCode: string): Promise<UploadResult | null> {
    if (!this.s3Client) {
      this.logger.debug('R2 not configured, skipping image upload');
      return null;
    }

    try {
      const response = await fetch(sourceUrl, {
        // SC-24: honest user agent, never a browser's
        headers: { 'User-Agent': CAIXA_USER_AGENT },
      });

      if (!response.ok) {
        this.logger.warn(`Failed to fetch image from ${sourceUrl}: ${response.status}`);
        return null;
      }

      const contentType = response.headers.get('content-type') || 'image/jpeg';
      const buffer = Buffer.from(await response.arrayBuffer());

      // Determine file extension from content type
      const ext = this.getExtensionFromMimeType(contentType);
      const key = `images/${auctionCode}${ext}`;

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );

      const url = this.publicUrl ? `${this.publicUrl}/${key}` : key;

      this.logger.debug(`Uploaded image for ${auctionCode}: ${key} (${buffer.length} bytes)`);

      return {
        key,
        url,
        size: buffer.length,
      };
    } catch (error) {
      this.logger.error(`Failed to upload image from ${sourceUrl}: ${errorMessage(error)}`);
      return null;
    }
  }

  /**
   * Upload a document (PDF) from a URL to R2
   * Documents are stored privately and accessed via signed URLs
   */
  async uploadDocumentFromUrl(
    sourceUrl: string,
    auctionCode: string,
    type: 'matricula' | 'edital',
  ): Promise<DocumentUploadResult | null> {
    if (!this.s3Client) {
      this.logger.debug('R2 not configured, skipping document upload');
      return null;
    }

    try {
      const response = await fetch(sourceUrl, {
        // SC-24: honest user agent, never a browser's
        headers: { 'User-Agent': CAIXA_USER_AGENT },
      });

      if (!response.ok) {
        this.logger.warn(`Failed to fetch document from ${sourceUrl}: ${response.status}`);
        return null;
      }

      const contentType = response.headers.get('content-type') || 'application/pdf';
      const buffer = Buffer.from(await response.arrayBuffer());

      const key = `documents/${auctionCode}/${type}.pdf`;

      await this.s3Client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: buffer,
          ContentType: contentType,
        }),
      );

      const url = this.publicUrl ? `${this.publicUrl}/${key}` : key;

      this.logger.debug(`Uploaded ${type} for ${auctionCode}: ${key} (${buffer.length} bytes)`);

      return {
        key,
        url,
        size: buffer.length,
      };
    } catch (error) {
      this.logger.error(`Failed to upload document from ${sourceUrl}: ${errorMessage(error)}`);
      return null;
    }
  }

  /**
   * SPEC-002 BR-002-08 / BR-002-09 / SC-18: a download link for a CLIENT file, valid for
   * PRIVATE_FILE_LINK_SECONDS (60 s, fixed: no caller chooses a longer one). Call it only after the
   * caller's access to the file was checked on this request (BR-002-15); never store, email or log
   * the link (SPEC-017 is its first caller). Refuses a key outside PRIVATE_FILE_PREFIX, so it cannot
   * sign the public catalogue's files either. Signs against R2_PRIVATE_BUCKET only, and refuses when
   * it is not configured: it never falls back to the public bucket. Neither the key nor the link is
   * ever logged.
   */
  async issuePrivateFileLink(key: string): Promise<string> {
    if (!isPrivateFileKey(key)) {
      throw new Error('Not a private file key (SC-18)');
    }
    if (!this.s3Client) {
      throw new Error('R2 not configured');
    }
    const command = new GetObjectCommand({ Bucket: this.privateBucketOrRefuse(), Key: key });
    return getSignedUrl(this.s3Client, command, { expiresIn: PRIVATE_FILE_LINK_SECONDS });
  }

  /**
   * Generate a signed URL for accessing a public-catalogue document. Private client files go
   * through issuePrivateFileLink only (60 s, SC-18), so they are refused here.
   * @param key The R2 object key
   * @param expiresIn Expiration time in seconds (default: 1 hour)
   */
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string | null> {
    if (key.startsWith(PRIVATE_FILE_PREFIX)) {
      throw new Error('A private file is linked by issuePrivateFileLink only (SC-18)');
    }
    if (!this.s3Client) {
      this.logger.debug('R2 not configured, cannot generate signed URL');
      return null;
    }

    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, { expiresIn });
      return signedUrl;
    } catch (error) {
      this.logger.error(`Failed to generate signed URL for ${key}: ${errorMessage(error)}`);
      return null;
    }
  }

  /**
   * Delete a file from R2 by its storage key
   */
  async deleteFile(key: string): Promise<boolean> {
    if (!this.s3Client) {
      this.logger.debug('R2 not configured, skipping file deletion');
      return false;
    }

    // SC-18: outside the try, so an unconfigured private bucket is a refusal, not a quiet false.
    const bucket = this.bucketFor(key);
    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: key,
        }),
      );

      this.logger.debug(`Deleted file from R2: ${loggableKey(key)}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete file ${loggableKey(key)}: ${errorMessage(error)}`);
      return false;
    }
  }

  /**
   * Upload a buffer to R2 with a given key
   */
  async uploadBuffer(
    key: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<{ key: string; size: number }> {
    if (!this.s3Client) {
      throw new Error('R2 not configured');
    }

    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketFor(key),
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    this.logger.debug(`Uploaded buffer: ${loggableKey(key)} (${buffer.length} bytes)`);

    return { key, size: buffer.length };
  }

  /**
   * Download a file from R2 as a Buffer
   */
  async downloadBuffer(key: string): Promise<Buffer> {
    if (!this.s3Client) {
      throw new Error('R2 not configured');
    }

    const response = await this.s3Client.send(
      new GetObjectCommand({
        Bucket: this.bucketFor(key),
        Key: key,
      }),
    );

    // An object read always carries a body; fail clearly if one ever does not (DV-03).
    if (!response.Body) {
      throw new Error(`R2 object ${loggableKey(key)} has no body`);
    }
    const bytes = await response.Body.transformToByteArray();
    this.logger.debug(`Downloaded buffer: ${loggableKey(key)} (${bytes.length} bytes)`);

    return Buffer.from(bytes);
  }

  /**
   * SC-18: the bucket a key lives in. A client file (PRIVATE_FILE_PREFIX) lives only in the private
   * bucket, so an upload, download or delete of one never touches the public bucket; every other key
   * is the public catalogue's.
   */
  private bucketFor(key: string): string {
    return key.startsWith(PRIVATE_FILE_PREFIX) ? this.privateBucketOrRefuse() : this.bucket;
  }

  /** SC-18: the private bucket, or a refusal; never the public bucket in its place. */
  private privateBucketOrRefuse(): string {
    if (!this.privateBucket) {
      throw new Error('The private file bucket is not configured (R2_PRIVATE_BUCKET, SC-18)');
    }
    return this.privateBucket;
  }

  private getExtensionFromMimeType(mimeType: string): string {
    const mimeToExt: Record<string, string> = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/gif': '.gif',
      'image/webp': '.webp',
    };
    return mimeToExt[mimeType] || '.jpg';
  }
}
