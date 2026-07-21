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
import type {
  HeadObjectResult,
  PresignGetRequest,
  PresignPutRequest,
  PresignPutResult,
  StorageVisibility,
} from './storage.types';
import { DOWNLOAD_URL_TTL_SECONDS, UPLOAD_URL_TTL_SECONDS } from './storage.types';

/**
 * Platform-level object storage service.
 *
 * Provides generic presign/head/delete primitives — no domain knowledge. Feature
 * modules go through AttachmentsService (which owns policy) rather than calling
 * this directly.
 *
 * Two buckets, selected per call by `visibility`:
 *
 *   private — everything permission-gated. Reachable only through a short-lived
 *             presigned GET minted after an authorization check.
 *   public  — CDN-fronted, world-readable by key. Only ever for non-sensitive
 *             assets (avatars, workspace logos).
 *
 * The split is enforced here rather than by convention because the failure mode
 * of getting it wrong is silent: a private object in a CDN-fronted bucket leaks
 * with no error anywhere.
 *
 * Registered as a global provider via PlatformModule — no need to re-import.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly s3: S3Client;
  private readonly privateBucket: string;
  private readonly publicBucket: string | null;
  private readonly cdnBaseUrl: string | null;

  readonly downloadTtlSeconds = DOWNLOAD_URL_TTL_SECONDS;

  constructor(
    private readonly config: AppConfigService,
    private readonly resilience: ResilienceService,
  ) {
    this.privateBucket = config.get('S3_ATTACHMENTS_BUCKET');
    this.publicBucket = config.get('S3_PUBLIC_ASSETS_BUCKET') ?? null;
    this.cdnBaseUrl = config.get('CDN_PUBLIC_ASSETS_BASE_URL') ?? null;

    // Provider-neutral client: no endpoint → AWS S3 (task-role credential chain);
    // endpoint set → S3-compatible backend (Cloudflare R2, MinIO) with static
    // credentials and path-style addressing. Same SDK, selected by config.
    const endpoint = config.get('STORAGE_ENDPOINT');
    const accessKeyId = config.get('STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = config.get('STORAGE_SECRET_ACCESS_KEY');

    this.s3 = new S3Client({
      region: endpoint ? 'auto' : config.get('AWS_REGION'),
      ...(endpoint ? { endpoint, forcePathStyle: config.get('STORAGE_FORCE_PATH_STYLE') } : {}),
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });
  }

  /**
   * Presigned PUT for direct client-to-bucket upload, expiring in
   * UPLOAD_URL_TTL_SECONDS (5 min).
   *
   * Content-Type, Content-Length and the SHA-256 checksum are all bound into the
   * signature. The checksum is the important one: the bucket verifies the body
   * against it and rejects a mismatch, so a client cannot declare one file and
   * upload another. Verifying only on confirm (and only by size) could not
   * detect a same-length substitution.
   *
   * Content-Disposition is baked in at PUT time so it is stored as object
   * metadata and therefore applies to EVERY later read — including a CDN read
   * that never passes through presignGet.
   */
  async presignPut(req: PresignPutRequest): Promise<PresignPutResult> {
    const uploadUrl = await this.resilience.execute(
      'storage.presignPut',
      () =>
        getSignedUrl(
          this.s3,
          new PutObjectCommand({
            Bucket: this.bucketFor(req.visibility),
            Key: req.key,
            ContentType: req.mimeType,
            ContentLength: req.sizeBytes,
            ChecksumSHA256: req.checksumSha256,
          }),
          {
            expiresIn: UPLOAD_URL_TTL_SECONDS,
            signableHeaders: new Set(['content-type', 'content-length', 'x-amz-checksum-sha256']),
          },
        ),
      ResiliencePreset.STORAGE,
    );

    return {
      uploadUrl,
      requiredHeaders: {
        'Content-Type': req.mimeType,
        'x-amz-checksum-sha256': req.checksumSha256,
      },
    };
  }

  /**
   * Presigned GET for time-limited private download, expiring in
   * DOWNLOAD_URL_TTL_SECONDS (15 min).
   *
   * Forces `Content-Disposition: attachment` unless the caller explicitly opts
   * into inline rendering. MIME is client-declared, so a file claiming to be a
   * PNG may contain script; serving it as a download makes that inert whatever
   * the bytes are. Only policies with a raster-only MIME set may pass inline.
   */
  async presignGet(req: PresignGetRequest): Promise<string> {
    return this.resilience.execute(
      'storage.presignGet',
      () =>
        getSignedUrl(
          this.s3,
          new GetObjectCommand({
            Bucket: this.bucketFor(req.visibility),
            Key: req.key,
            ResponseContentDisposition: this.contentDisposition(req.filename, req.inline),
            ResponseContentType: req.mimeType,
          }),
          { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
        ),
      ResiliencePreset.STORAGE,
    );
  }

  /**
   * HEAD an object to verify it was actually uploaded, and read back its size
   * and stored checksum. Returns null if the object does not exist.
   */
  async headObject(
    key: string,
    visibility: StorageVisibility = 'private',
  ): Promise<HeadObjectResult | null> {
    try {
      const result = await this.resilience.execute(
        'storage.headObject',
        () =>
          this.s3.send(
            new HeadObjectCommand({
              Bucket: this.bucketFor(visibility),
              Key: key,
              ChecksumMode: 'ENABLED',
            }),
          ),
        ResiliencePreset.STORAGE,
      );
      return {
        contentLength: result.ContentLength ?? 0,
        checksumSha256: result.ChecksumSHA256 ?? null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Hard-delete an object.
   * Errors are logged but NOT re-thrown — callers that have already soft-deleted
   * the DB record should treat object deletion as best-effort. The worker reaper
   * re-attempts anything that was missed.
   */
  async deleteObject(key: string, visibility: StorageVisibility = 'private'): Promise<void> {
    try {
      await this.resilience.execute(
        'storage.deleteObject',
        () =>
          this.s3.send(new DeleteObjectCommand({ Bucket: this.bucketFor(visibility), Key: key })),
        ResiliencePreset.STORAGE,
      );
    } catch (err) {
      this.logger.error({ key, err }, 'Failed to delete object — manual cleanup may be needed');
    }
  }

  /**
   * CDN URL for a PUBLIC object. Returns null when no CDN is configured.
   *
   * Deliberately has no private-bucket path. Fronting the private bucket with a
   * CDN domain would make every object readable by key, bypassing every
   * authorization check — and would turn any stored active content into
   * same-site XSS. Private objects are always served via presignGet.
   */
  cdnUrl(key: string): string | null {
    return this.cdnBaseUrl ? `${this.cdnBaseUrl}/${key}` : null;
  }

  private bucketFor(visibility: StorageVisibility): string {
    if (visibility === 'private') return this.privateBucket;
    if (!this.publicBucket) {
      throw new Error(
        'S3_PUBLIC_ASSETS_BUCKET is not configured — cannot store a public asset. ' +
          'Refusing to fall back to the private bucket.',
      );
    }
    return this.publicBucket;
  }

  /**
   * RFC 5987 encoding. The filename is attacker-controlled, so it is emitted
   * only in the escaped `filename*` form and never interpolated raw — a quote or
   * newline in a filename would otherwise let the caller inject header content.
   */
  private contentDisposition(filename: string, inline: boolean): string {
    const type = inline ? 'inline' : 'attachment';
    const safe = encodeURIComponent(filename).replace(/['()*]/g, (c) => {
      const code = c.charCodeAt(0).toString(16).toUpperCase();
      return `%${code}`;
    });
    return `${type}; filename*=UTF-8''${safe}`;
  }
}
