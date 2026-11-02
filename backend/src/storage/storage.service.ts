import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import r2Config from './r2.config';
import { errorMessage } from '../common/error-message';

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

  constructor(
    @Inject(r2Config.KEY)
    private readonly config: ConfigType<typeof r2Config>,
  ) {
    const { accountId, accessKeyId, secretAccessKey, bucket, publicUrl } = config;

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
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
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
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
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
   * Generate a signed URL for accessing a private document
   * @param key The R2 object key
   * @param expiresIn Expiration time in seconds (default: 1 hour)
   */
  async getSignedUrl(key: string, expiresIn = 3600): Promise<string | null> {
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

    try {
      await this.s3Client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        }),
      );

      this.logger.debug(`Deleted file from R2: ${key}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete file ${key}: ${errorMessage(error)}`);
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
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    this.logger.debug(`Uploaded buffer: ${key} (${buffer.length} bytes)`);

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
        Bucket: this.bucket,
        Key: key,
      }),
    );

    // An object read always carries a body; fail clearly if one ever does not (DV-03).
    if (!response.Body) {
      throw new Error(`R2 object ${key} has no body`);
    }
    const bytes = await response.Body.transformToByteArray();
    this.logger.debug(`Downloaded buffer: ${key} (${bytes.length} bytes)`);

    return Buffer.from(bytes);
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
