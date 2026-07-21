import { Inject, Injectable, Logger } from '@nestjs/common';
import { uuidv7 } from 'uuidv7';
import { NotFoundException, PreconditionFailedException, Span, StorageService } from '@platform';
import type { JwtPayload } from '@platform';
import { FILE_REPOSITORY, type IFileRepository } from '../domain/ports/file.repository';
import type { UploadPolicy } from '../domain/attachment-policy';
import type { PresignedUpload, StoredFile } from '../domain/file.types';

/** Base64 SHA-256 is always 44 chars ending in '='. */
const BASE64_SHA256 = /^[A-Za-z0-9+/]{43}=$/;

export interface PresignRequest {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  /** Base64-encoded SHA-256 of the file bytes, computed by the client. */
  checksumSha256: string;
}

/**
 * Shared upload mechanics for every surface in the product.
 *
 * This service knows nothing about work items, comments or users. Callers
 * authorize first, then delegate here with their UploadPolicy. That boundary is
 * what lets a new upload surface be a descriptor plus a link table instead of a
 * second copy of presign/confirm/reap.
 */
@Injectable()
export class AttachmentsService {
  private readonly logger = new Logger(AttachmentsService.name);

  constructor(
    @Inject(FILE_REPOSITORY) private readonly fileRepo: IFileRepository,
    private readonly storage: StorageService,
  ) {}

  /**
   * Validate against the policy, reserve a storage.files row, and mint a
   * presigned PUT bound to the exact content-type, length AND checksum.
   *
   * Binding the checksum into the signature is what makes the upload
   * tamper-evident: the bucket itself rejects a body whose SHA-256 does not
   * match, so a client cannot declare one file and upload another. The old
   * size-only comparison on confirm could not detect a same-length swap.
   *
   * `currentOwnerCount` is supplied by the caller because only the owning
   * context knows its link table. Pass 0 for surfaces without a quota.
   */
  @Span('attachments.presign')
  async presign(
    actor: JwtPayload,
    policy: UploadPolicy,
    req: PresignRequest,
    currentOwnerCount: number,
  ): Promise<PresignedUpload> {
    if (!policy.allowedMimeTypes.has(req.mimeType)) {
      throw new PreconditionFailedException(
        'ATTACHMENT_INVALID_TYPE',
        `File type '${req.mimeType}' is not allowed`,
      );
    }

    if (req.sizeBytes <= 0 || req.sizeBytes > policy.maxSizeBytes) {
      throw new PreconditionFailedException(
        'ATTACHMENT_FILE_TOO_LARGE',
        `File exceeds the maximum size of ${Math.floor(policy.maxSizeBytes / 1024 / 1024)}MB`,
      );
    }

    if (!BASE64_SHA256.test(req.checksumSha256)) {
      throw new PreconditionFailedException(
        'ATTACHMENT_INVALID_CHECKSUM',
        'checksumSha256 must be a base64-encoded SHA-256 digest',
      );
    }

    if (policy.maxPerOwner !== null && currentOwnerCount >= policy.maxPerOwner) {
      throw new PreconditionFailedException(
        'ATTACHMENT_LIMIT_EXCEEDED',
        `Maximum of ${policy.maxPerOwner} attachments reached`,
      );
    }

    const id = uuidv7();
    const storageKey = this.buildKey(policy, actor.workspaceId, id, req.filename);

    await this.fileRepo.create({
      id,
      workspaceId: actor.workspaceId,
      storageKey,
      filename: req.filename,
      mimeType: req.mimeType,
      sizeBytes: req.sizeBytes,
      checksumSha256: req.checksumSha256,
      visibility: policy.visibility,
      uploadedBy: actor.sub,
    });

    const { uploadUrl, requiredHeaders } = await this.storage.presignPut({
      key: storageKey,
      mimeType: req.mimeType,
      sizeBytes: req.sizeBytes,
      checksumSha256: req.checksumSha256,
      visibility: policy.visibility,
    });

    return { fileId: id, uploadUrl, requiredHeaders };
  }

  /**
   * Verify the object actually landed and matches what was declared, then flip
   * the row to completed. Returns the file so the caller can create its link row
   * in the same request.
   */
  @Span('attachments.confirm')
  async confirm(actor: JwtPayload, fileId: string, policy: UploadPolicy): Promise<StoredFile> {
    const file = await this.requirePending(actor.workspaceId, fileId);

    const head = await this.storage.headObject(file.storageKey, policy.visibility);
    if (!head) {
      throw new PreconditionFailedException(
        'ATTACHMENT_NOT_UPLOADED',
        'File not found in storage — please upload first',
      );
    }

    if (head.contentLength !== file.sizeBytes) {
      await this.discard(file, 'size mismatch');
      throw new PreconditionFailedException(
        'ATTACHMENT_SIZE_MISMATCH',
        'Uploaded file size does not match declared size',
      );
    }

    // The bucket enforces this at PUT time; re-checking here catches a backend
    // that silently ignored the checksum header rather than rejecting the body.
    if (head.checksumSha256 && file.checksumSha256 && head.checksumSha256 !== file.checksumSha256) {
      await this.discard(file, 'checksum mismatch');
      throw new PreconditionFailedException(
        'ATTACHMENT_CHECKSUM_MISMATCH',
        'Uploaded file does not match the declared checksum',
      );
    }

    return this.fileRepo.confirm(fileId, head.checksumSha256 ?? null);
  }

  /**
   * Mint a short-lived download URL. Callers MUST have authorized the actor
   * against the owning entity first — this method only enforces that the file
   * belongs to the actor's workspace.
   *
   * `Content-Disposition` is forced to `attachment` unless the policy explicitly
   * opts into inline rendering, so a file whose declared MIME lies about its
   * contents cannot execute in a browsing context.
   */
  @Span('attachments.download-url')
  async getDownloadUrl(
    actor: JwtPayload,
    fileId: string,
    policy: UploadPolicy,
  ): Promise<{ url: string; expiresInSeconds: number }> {
    const file = await this.fileRepo.findById(fileId, actor.workspaceId);
    if (!file || file.status !== 'completed') {
      throw new NotFoundException('ATTACHMENT_NOT_FOUND', 'Attachment not found');
    }

    // Public assets are CDN-served and need no signature.
    const cdn = policy.visibility === 'public' ? this.storage.cdnUrl(file.storageKey) : null;
    if (cdn) return { url: cdn, expiresInSeconds: 0 };

    const url = await this.storage.presignGet({
      key: file.storageKey,
      filename: file.filename,
      mimeType: file.mimeType,
      inline: policy.inlineDisposition,
      visibility: policy.visibility,
    });
    return { url, expiresInSeconds: this.storage.downloadTtlSeconds };
  }

  /**
   * Soft-delete the file row. The object itself is removed by the worker reaper
   * rather than here: a file may be referenced by more than one link row, and
   * only the reaper can see that the last reference is gone.
   */
  @Span('attachments.soft-delete')
  async softDelete(fileId: string): Promise<void> {
    await this.fileRepo.softDelete(fileId);
  }

  async findById(workspaceId: string, fileId: string): Promise<StoredFile | null> {
    return this.fileRepo.findById(fileId, workspaceId);
  }

  private async requirePending(workspaceId: string, fileId: string): Promise<StoredFile> {
    const file = await this.fileRepo.findById(fileId, workspaceId);
    if (!file) throw new NotFoundException('ATTACHMENT_NOT_FOUND', 'Attachment not found');
    if (file.status !== 'pending') {
      throw new PreconditionFailedException(
        'ATTACHMENT_NOT_PENDING',
        'Attachment is not in pending state',
      );
    }
    return file;
  }

  private async discard(file: StoredFile, reason: string): Promise<void> {
    this.logger.warn({ fileId: file.id, reason }, 'Discarding attachment that failed verification');
    await this.fileRepo.softDelete(file.id);
    void this.storage.deleteObject(file.storageKey, file.visibility);
  }

  /**
   * Key layout: <surface>/<workspaceId>/<fileId><ext>
   *
   * The surface prefix is what makes bucket lifecycle rules and per-surface cost
   * attribution possible. The workspace segment keeps a bucket listing
   * tenant-partitioned. The id is a uuidv7 so keys sort by creation time.
   *
   * The client filename is NEVER part of the key — only its extension, and only
   * after being reduced to a short alphanumeric token. A filename reaching the
   * key is how path traversal and control characters get into object storage.
   */
  private buildKey(
    policy: UploadPolicy,
    workspaceId: string,
    fileId: string,
    filename: string,
  ): string {
    const rawExt = filename.includes('.') ? (filename.split('.').pop() ?? '') : '';
    const ext = /^[A-Za-z0-9]{1,12}$/.test(rawExt) ? `.${rawExt.toLowerCase()}` : '';
    return `${policy.surface}/${workspaceId}/${fileId}${ext}`;
  }
}
