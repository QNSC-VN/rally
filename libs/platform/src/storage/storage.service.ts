import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { ResilienceService } from '../resilience/resilience.service';
import { ResiliencePreset } from '../resilience/resilience.types';
import type { HeadObjectResult, PresignPutResult } from './storage.types';
import { DOWNLOAD_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS } from './storage.types';

/**
 * Platform-level S3 storage service.
 *
 * Provides generic presign/head/delete primitives — no domain knowledge.
 * Feature modules (work-items, collaboration, identity) inject this service
 * and apply their own validation rules and access control.
 *
 * Registered as a global provider via PlatformModule — no need to re-import.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly cdnBaseUrl: string | null;

  constructor(
    private readonly config: AppConfigService,
    private readonly resilience: ResilienceService,
  ) {
    this.bucket = config.get('S3_ATTACHMENTS_BUCKET');
    this.cdnBaseUrl = config.get('CDN_ATTACHMENTS_BASE_URL') ?? null;

    this.s3 = new S3Client({
      region: config.get('AWS_REGION'),
    });
  }

  /**
   * Generate a presigned S3 PUT URL for direct client-to-S3 upload.
   * URL expires in UPLOAD_URL_TTL_SECONDS (5 min).
   */
  async presignPut(key: string, mimeType: string, sizeBytes: number): Promise<PresignPutResult> {
    const uploadUrl = await this.resilience.execute(
      's3.presignPut',
      () =>
        getSignedUrl(
          this.s3,
          new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ContentType: mimeType,
            ContentLength: sizeBytes,
          }),
          { expiresIn: UPLOAD_URL_TTL_SECONDS },
        ),
      ResiliencePreset.STORAGE,
    );
    return { uploadUrl };
  }

  /**
   * Generate a presigned S3 GET URL for time-limited private download.
   * URL expires in DOWNLOAD_URL_TTL_SECONDS (15 min).
   */
  async presignGet(key: string): Promise<string> {
    return this.resilience.execute(
      's3.presignGet',
      () =>
        getSignedUrl(this.s3, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
          expiresIn: DOWNLOAD_URL_TTL_SECONDS,
        }),
      ResiliencePreset.STORAGE,
    );
  }

  /**
   * HEAD an object to verify it was actually uploaded and get its size.
   * Returns null if the object does not exist in S3.
   */
  async headObject(key: string): Promise<HeadObjectResult | null> {
    try {
      const result = await this.resilience.execute(
        's3.headObject',
        () => this.s3.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })),
        ResiliencePreset.STORAGE,
      );
      return { contentLength: result.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  /**
   * Hard-delete an S3 object.
   * Errors are logged but NOT re-thrown — callers that have already soft-deleted
   * the DB record should treat S3 deletion as best-effort.
   */
  async deleteObject(key: string): Promise<void> {
    try {
      await this.resilience.execute(
        's3.deleteObject',
        () => this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })),
        ResiliencePreset.STORAGE,
      );
    } catch (err) {
      this.logger.error({ key, err }, 'Failed to delete S3 object — manual cleanup may be needed');
    }
  }

  /**
   * Build a CDN URL for a given S3 key, if CDN_ATTACHMENTS_BASE_URL is set.
   * Returns null otherwise — callers should fall back to presignGet().
   */
  cdnUrl(key: string): string | null {
    return this.cdnBaseUrl ? `${this.cdnBaseUrl}/${key}` : null;
  }
}
