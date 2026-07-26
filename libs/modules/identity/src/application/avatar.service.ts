import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConflictException, StorageService } from '@platform';
import type { AVATAR_CONTENT_TYPES } from '../interface/http/dto/avatar.dto';

type AvatarContentType = (typeof AVATAR_CONTENT_TYPES)[number];

/** File extension chosen per content type — keeps the stored key self-describing. */
const EXT_BY_TYPE: Record<AvatarContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

/**
 * Avatar upload orchestration — mints a presigned PUT into the PUBLIC assets
 * bucket and returns the CDN URL the object will resolve at, so the client can
 * upload directly and then persist `avatarUrl` via the existing profile update.
 *
 * No DB writes here: the avatar URL is stored by `PATCH /auth/me { avatarUrl }`,
 * exactly as a manually-entered URL was before.
 */
@Injectable()
export class AvatarService {
  constructor(private readonly storage: StorageService) {}

  async presignUpload(
    userId: string,
    input: { contentType: AvatarContentType; contentLength: number },
  ): Promise<{ uploadUrl: string; publicUrl: string }> {
    const key = `avatars/${userId}/${randomUUID()}.${EXT_BY_TYPE[input.contentType]}`;

    // Resolve the public (CDN) URL first: without a CDN base the uploaded object
    // is unreachable, so fail fast with a stable code instead of handing back an
    // upload URL that leads nowhere.
    const publicUrl = this.storage.cdnUrl(key);
    if (!publicUrl) {
      throw new ConflictException(
        'AVATAR_STORAGE_UNCONFIGURED',
        'Avatar storage is not configured (no public CDN base URL).',
      );
    }

    const { uploadUrl } = await this.storage.presignPut({
      visibility: 'public',
      key,
      mimeType: input.contentType,
      sizeBytes: input.contentLength,
    });

    return { uploadUrl, publicUrl };
  }
}
